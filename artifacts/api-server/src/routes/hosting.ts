import { getAuth } from "@clerk/express";
import {
  and,
  desc,
  eq,
  gte,
  lt,
  sql,
} from "drizzle-orm";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import {
  CreateBotInstanceBody,
  CreateBotInstanceResponse,
  CreateWalletTopupBody,
  CreateWalletTopupResponse,
  GetDashboardSummaryResponse,
  GetWalletResponse,
  ListBotInstancesResponse,
  ListBotTemplatesResponse,
  ReceivePaystackWebhookBody,
  ReceivePaystackWebhookResponse,
  RenewBotInstanceParams,
  RenewBotInstanceResponse,
  RestartBotInstanceParams,
  RestartBotInstanceResponse,
  StopBotInstanceParams,
  StopBotInstanceResponse,
  VerifyWalletTopupQueryParams,
  VerifyWalletTopupResponse,
} from "@workspace/api-zod";
import {
  activitiesTable,
  botInstancesTable,
  db,
  walletAccountsTable,
  walletTransactionsTable,
} from "@workspace/db";
import { Router, type IRouter, type RequestHandler } from "express";
import { ensureWalletAccount, getVerifiedAccountEmail } from "../lib/accounts";
import { BOT_TEMPLATES, getBotTemplate } from "../lib/bot-templates";
import {
  createHerokuDeployment,
  getHerokuBuild,
  startHerokuApp,
  stopHerokuApp,
} from "../lib/heroku";
import {
  initializePaystackTransaction,
  verifyPaystackSignature,
  verifyPaystackTransaction,
} from "../lib/paystack";
import { encryptSessionId } from "../lib/session-crypto";

const router: IRouter = Router();
const MONTHLY_PRICE_KSH = 50;
const BILLING_PERIOD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const requireAuth: RequestHandler = (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  res.locals.userId = userId;
  next();
};

function currentUserId(res: Parameters<RequestHandler>[1]): string {
  return res.locals.userId as string;
}

function newActivity(
  clerkUserId: string,
  title: string,
  detail: string,
  kind: "payment" | "deploy" | "renewal" | "system",
) {
  return db.insert(activitiesTable).values({ clerkUserId, title, detail, kind });
}

function mapInstance(
  instance: typeof botInstancesTable.$inferSelect,
) {
  return {
    id: instance.id,
    templateId: instance.templateId,
    templateName: instance.templateName,
    name: instance.name,
    status: instance.status,
    herokuAppName: instance.herokuAppName,
    phoneNumber: instance.phoneNumber,
    errorMessage: instance.errorMessage,
    createdAt: instance.createdAt,
    renewalAt: instance.renewalAt,
  };
}

async function applyWalletCredit(reference: string, amountKsh: number) {
  await db.transaction(async (tx) => {
    const [completed] = await tx
      .update(walletTransactionsTable)
      .set({ status: "completed" })
      .where(
        and(
          eq(walletTransactionsTable.reference, reference),
          eq(walletTransactionsTable.kind, "credit"),
          eq(walletTransactionsTable.status, "pending"),
          eq(walletTransactionsTable.amountKsh, amountKsh),
        ),
      )
      .returning({ clerkUserId: walletTransactionsTable.clerkUserId });
    if (!completed) return;

    await tx
      .update(walletAccountsTable)
      .set({
        balanceKsh: sql`${walletAccountsTable.balanceKsh} + ${amountKsh}`,
      })
      .where(eq(walletAccountsTable.clerkUserId, completed.clerkUserId));
    await tx.insert(activitiesTable).values({
      clerkUserId: completed.clerkUserId,
      title: "Wallet funded",
      detail: `KSh ${amountKsh.toLocaleString("en-KE")} added to your balance.`,
      kind: "payment",
    });
  });
}

async function issueRefund(
  userId: string,
  instanceId: string,
  amountKsh: number,
  reason: string,
) {
  await db.transaction(async (tx) => {
    const [refund] = await tx
      .insert(walletTransactionsTable)
      .values({
        clerkUserId: userId,
        kind: "refund",
        status: "completed",
        amountKsh,
        description: reason,
        reference: `refund-${instanceId}`,
      })
      .onConflictDoNothing()
      .returning({ id: walletTransactionsTable.id });
    if (!refund) return;

    await tx
      .update(walletAccountsTable)
      .set({
        balanceKsh: sql`${walletAccountsTable.balanceKsh} + ${amountKsh}`,
      })
      .where(eq(walletAccountsTable.clerkUserId, userId));
    await tx.insert(activitiesTable).values({
      clerkUserId: userId,
      title: "Wallet credit returned",
      detail: reason,
      kind: "payment",
    });
  });
}

async function monitorHerokuBuild(
  instanceId: string,
  ownerId: string,
  appId: string,
  buildId: string,
) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const build = await getHerokuBuild(appId, buildId);
    if (build.status === "pending") continue;

    if (build.status === "succeeded" || build.status === "successful") {
      await startHerokuApp(appId);
      await db
        .update(botInstancesTable)
        .set({ status: "running", errorMessage: null })
        .where(
          and(
            eq(botInstancesTable.id, instanceId),
            eq(botInstancesTable.clerkUserId, ownerId),
          ),
        );
      await newActivity(
        ownerId,
        "Bot is online",
        "Heroku finished building and started your bot.",
        "deploy",
      );
      return;
    }

    if (build.status === "failed") {
      await stopHerokuApp(appId).catch(() => undefined);
      await db
        .update(botInstancesTable)
        .set({
          status: "failed",
          errorMessage: "Heroku could not build this repository. Check its build logs and Procfile.",
        })
        .where(eq(botInstancesTable.id, instanceId));
      await issueRefund(
        ownerId,
        instanceId,
        MONTHLY_PRICE_KSH,
        "Deployment failed; the first month's KSh 50 charge was returned.",
      );
      await newActivity(
        ownerId,
        "Deployment needs attention",
        "The repository failed to build. Your wallet charge was returned.",
        "system",
      );
      return;
    }
  }
}

router.get("/bots", (_req, res): void => {
  res.json(ListBotTemplatesResponse.parse(BOT_TEMPLATES));
});

router.post("/payments/paystack/webhook", async (req, res): Promise<void> => {
  const signature = req.get("x-paystack-signature") ?? "";
  if (!Buffer.isBuffer(req.body) || !verifyPaystackSignature(req.body, signature)) {
    res.status(401).json({ error: "Invalid webhook signature." });
    return;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(req.body.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid webhook payload." });
    return;
  }
  const event = ReceivePaystackWebhookBody.safeParse(decoded);
  if (!event.success) {
    res.status(400).json({ error: "Invalid webhook payload." });
    return;
  }

  const payload = event.data as {
    event?: unknown;
    data?: { reference?: unknown; status?: unknown; amount?: unknown; currency?: unknown };
  };
  const transaction = payload.data;
  if (
    payload.event === "charge.success" &&
    transaction &&
    typeof transaction.reference === "string" &&
    transaction.status === "success" &&
    transaction.currency === "KES" &&
    typeof transaction.amount === "number" &&
    Number.isSafeInteger(transaction.amount) &&
    transaction.amount % 100 === 0
  ) {
    await applyWalletCredit(transaction.reference, transaction.amount / 100);
  }

  res.json(ReceivePaystackWebhookResponse.parse({ received: true }));
});

router.use(requireAuth);

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const userId = currentUserId(res);
  const account = await ensureWalletAccount(userId);
  const instances = await db
    .select()
    .from(botInstancesTable)
    .where(eq(botInstancesTable.clerkUserId, userId));
  const [renewal] = await db
    .select({ renewalAt: botInstancesTable.renewalAt })
    .from(botInstancesTable)
    .where(
      and(
        eq(botInstancesTable.clerkUserId, userId),
        eq(botInstancesTable.status, "running"),
      ),
    )
    .orderBy(botInstancesTable.renewalAt)
    .limit(1);
  const recent = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.clerkUserId, userId))
    .orderBy(desc(activitiesTable.createdAt))
    .limit(5);
  const activeBotCount = instances.filter((item) => item.status === "running").length;
  const deployingBotCount = instances.filter(
    (item) => item.status === "queued" || item.status === "deploying",
  ).length;

  res.json(
    GetDashboardSummaryResponse.parse({
      walletBalanceKsh: account.balanceKsh,
      activeBotCount,
      deployingBotCount,
      monthlySpendKsh: activeBotCount * MONTHLY_PRICE_KSH,
      botsFundable: Math.floor(account.balanceKsh / MONTHLY_PRICE_KSH),
      nextRenewalAt: renewal?.renewalAt ?? null,
      recentActivity: recent.map((activity) => ({
        id: activity.id,
        title: activity.title,
        detail: activity.detail,
        kind: activity.kind,
        createdAt: activity.createdAt,
      })),
    }),
  );
});

router.get("/wallet", async (_req, res): Promise<void> => {
  const userId = currentUserId(res);
  const account = await ensureWalletAccount(userId);
  const instances = await db
    .select({ status: botInstancesTable.status })
    .from(botInstancesTable)
    .where(eq(botInstancesTable.clerkUserId, userId));
  const entries = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.clerkUserId, userId))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(30);
  res.json(
    GetWalletResponse.parse({
      balanceKsh: account.balanceKsh,
      monthlyPriceKsh: MONTHLY_PRICE_KSH,
      activeBotCount: instances.filter((item) => item.status === "running").length,
      botsFundable: Math.floor(account.balanceKsh / MONTHLY_PRICE_KSH),
      entries: entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        status: entry.status,
        amountKsh: entry.amountKsh,
        description: entry.description,
        reference: entry.reference,
        createdAt: entry.createdAt,
      })),
    }),
  );
});

router.post("/wallet/topups", async (req, res): Promise<void> => {
  const parsed = CreateWalletTopupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = currentUserId(res);
  await ensureWalletAccount(userId);
  let email: string;
  try {
    email = await getVerifiedAccountEmail(userId);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Verify your email before checkout.",
    });
    return;
  }

  const reference = `wallet-${randomUUID()}`;
  const amountKsh = parsed.data.amountKsh;
  await db.insert(walletTransactionsTable).values({
    clerkUserId: userId,
    kind: "credit",
    status: "pending",
    amountKsh,
    description: "Paystack wallet top-up",
    reference,
  });

  try {
    const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.get("host");
    if (!host) throw new Error("The public app host is not available.");
    const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    const callbackUrl = `${protocol}://${host}/payments/return?reference=${encodeURIComponent(reference)}`;
    const checkout = await initializePaystackTransaction({
      email,
      amountKsh,
      reference,
      callbackUrl,
      userId,
    });
    res.status(201).json(
      CreateWalletTopupResponse.parse({
        authorizationUrl: checkout.authorization_url,
        reference: checkout.reference,
        amountKsh,
      }),
    );
  } catch (error) {
    await db
      .update(walletTransactionsTable)
      .set({ status: "failed" })
      .where(eq(walletTransactionsTable.reference, reference));
    req.log.warn(
      { message: error instanceof Error ? error.message : "unknown" },
      "Could not initialize Paystack checkout",
    );
    res.status(503).json({ error: "Could not start checkout. Please try again." });
  }
});

router.get("/payments/verify", async (req, res): Promise<void> => {
  const query = VerifyWalletTopupQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const userId = currentUserId(res);
  const [pending] = await db
    .select()
    .from(walletTransactionsTable)
    .where(
      and(
        eq(walletTransactionsTable.reference, query.data.reference),
        eq(walletTransactionsTable.clerkUserId, userId),
        eq(walletTransactionsTable.kind, "credit"),
      ),
    )
    .limit(1);
  if (!pending) {
    res.status(404).json({ error: "Payment reference not found for this account." });
    return;
  }

  let status: "successful" | "pending" | "failed" =
    pending.status === "completed"
      ? "successful"
      : pending.status === "failed"
        ? "failed"
        : "pending";
  if (pending.status === "pending") {
    try {
      const verified = await verifyPaystackTransaction(query.data.reference);
      if (
        verified.reference === query.data.reference &&
        verified.status === "success" &&
        verified.currency === "KES" &&
        verified.amount === pending.amountKsh * 100
      ) {
        await applyWalletCredit(query.data.reference, pending.amountKsh);
        status = "successful";
      } else if (verified.status === "failed" || verified.status === "abandoned") {
        await db
          .update(walletTransactionsTable)
          .set({ status: "failed" })
          .where(
            and(
              eq(walletTransactionsTable.reference, query.data.reference),
              eq(walletTransactionsTable.status, "pending"),
            ),
          );
        status = "failed";
      }
    } catch (error) {
      req.log.warn(
        { message: error instanceof Error ? error.message : "unknown" },
        "Could not verify Paystack transaction",
      );
    }
  }
  const account = await ensureWalletAccount(userId);
  res.json(
    VerifyWalletTopupResponse.parse({
      status,
      amountKsh: pending.amountKsh,
      walletBalanceKsh: account.balanceKsh,
    }),
  );
});

router.get("/instances", async (_req, res): Promise<void> => {
  const userId = currentUserId(res);
  await ensureWalletAccount(userId);
  const instances = await db
    .select()
    .from(botInstancesTable)
    .where(eq(botInstancesTable.clerkUserId, userId))
    .orderBy(desc(botInstancesTable.createdAt));
  res.json(ListBotInstancesResponse.parse(instances.map(mapInstance)));
});

router.post("/instances", async (req, res): Promise<void> => {
  const parsed = CreateBotInstanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = currentUserId(res);
  const template = getBotTemplate(parsed.data.templateId);
  if (!template) {
    res.status(400).json({ error: "Choose an available bot template." });
    return;
  }
  const repoUrl = new URL(parsed.data.repositoryUrl);
  if (
    repoUrl.protocol !== "https:" ||
    repoUrl.hostname !== "github.com" ||
    repoUrl.username ||
    repoUrl.password ||
    repoUrl.search ||
    repoUrl.hash
  ) {
    res.status(400).json({ error: "Use a public GitHub repository URL." });
    return;
  }

  const account = await ensureWalletAccount(userId);
  const instanceId = randomUUID();
  const renewalAt = new Date(Date.now() + BILLING_PERIOD_DAYS * MS_PER_DAY);
  const deploymentName = `bot-${randomUUID().replace(/-/g, "").slice(0, 14)}`;

  try {
    await db.transaction(async (tx) => {
      const [charged] = await tx
        .update(walletAccountsTable)
        .set({
          balanceKsh: sql`${walletAccountsTable.balanceKsh} - ${MONTHLY_PRICE_KSH}`,
        })
        .where(
          and(
            eq(walletAccountsTable.clerkUserId, userId),
            gte(walletAccountsTable.balanceKsh, MONTHLY_PRICE_KSH),
          ),
        )
        .returning({ balanceKsh: walletAccountsTable.balanceKsh });
      if (!charged) throw new Error("INSUFFICIENT_WALLET_BALANCE");

      await tx.insert(walletTransactionsTable).values({
        clerkUserId: userId,
        kind: "debit",
        status: "completed",
        amountKsh: MONTHLY_PRICE_KSH,
        description: `First month — ${template.name}`,
        reference: `deploy-${instanceId}`,
      });
      await tx.insert(botInstancesTable).values({
        id: instanceId,
        clerkUserId: userId,
        templateId: template.id,
        templateName: template.name,
        name: parsed.data.name,
        repositoryUrl: repoUrl.toString(),
        status: "queued",
        encryptedSessionId: encryptSessionId(parsed.data.sessionId),
        renewalAt,
      });
      await tx.insert(activitiesTable).values({
        clerkUserId: userId,
        title: "Bot deployment queued",
        detail: `${template.name} is being prepared on Heroku.`,
        kind: "deploy",
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_WALLET_BALANCE") {
      res.status(402).json({
        error: `Add at least KSh ${MONTHLY_PRICE_KSH} to deploy a bot.`,
        balanceKsh: account.balanceKsh,
      });
      return;
    }
    throw error;
  }

  try {
    const deployment = await createHerokuDeployment({
      appName: deploymentName,
      repositoryUrl: repoUrl.toString(),
      sessionId: parsed.data.sessionId,
      botTemplateId: template.id,
    });
    const [instance] = await db
      .update(botInstancesTable)
      .set({
        status: "deploying",
        herokuAppId: deployment.app.id,
        herokuAppName: deployment.app.name,
      })
      .where(
        and(
          eq(botInstancesTable.id, instanceId),
          eq(botInstancesTable.clerkUserId, userId),
        ),
      )
      .returning();
    void monitorHerokuBuild(
      instanceId,
      userId,
      deployment.app.id,
      deployment.build.id,
    ).catch((error: unknown) => {
      req.log.error(
        {
          instanceId,
          message: error instanceof Error ? error.message : "unknown",
        },
        "Heroku deployment monitor failed",
      );
    });
    res.status(201).json(CreateBotInstanceResponse.parse(mapInstance(instance)));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Heroku could not start this deployment.";
    await db
      .update(botInstancesTable)
      .set({ status: "failed", errorMessage: message })
      .where(eq(botInstancesTable.id, instanceId));
    await issueRefund(
      userId,
      instanceId,
      MONTHLY_PRICE_KSH,
      "Deployment could not start; the first month's KSh 50 charge was returned.",
    );
    req.log.warn({ instanceId, message }, "Heroku deployment could not be started");
    res.status(502).json({ error: message });
  }
});

router.post("/instances/:instanceId/restart", async (req, res): Promise<void> => {
  const params = RestartBotInstanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = currentUserId(res);
  const [instance] = await db
    .select()
    .from(botInstancesTable)
    .where(
      and(
        eq(botInstancesTable.id, params.data.instanceId),
        eq(botInstancesTable.clerkUserId, userId),
      ),
    )
    .limit(1);
  if (!instance) {
    res.status(404).json({ error: "Bot not found." });
    return;
  }
  if (
    !instance.herokuAppId ||
    !instance.renewalAt ||
    instance.renewalAt.getTime() <= Date.now() ||
    instance.status === "past_due"
  ) {
    res.status(402).json({ error: "Renew this bot before restarting it." });
    return;
  }
  await startHerokuApp(instance.herokuAppId);
  const [updated] = await db
    .update(botInstancesTable)
    .set({ status: "running", errorMessage: null })
    .where(eq(botInstancesTable.id, instance.id))
    .returning();
  res.json(RestartBotInstanceResponse.parse(mapInstance(updated)));
});

router.post("/instances/:instanceId/stop", async (req, res): Promise<void> => {
  const params = StopBotInstanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = currentUserId(res);
  const [instance] = await db
    .select()
    .from(botInstancesTable)
    .where(
      and(
        eq(botInstancesTable.id, params.data.instanceId),
        eq(botInstancesTable.clerkUserId, userId),
      ),
    )
    .limit(1);
  if (!instance) {
    res.status(404).json({ error: "Bot not found." });
    return;
  }
  if (instance.herokuAppId) await stopHerokuApp(instance.herokuAppId);
  const [updated] = await db
    .update(botInstancesTable)
    .set({ status: "stopped" })
    .where(eq(botInstancesTable.id, instance.id))
    .returning();
  res.json(StopBotInstanceResponse.parse(mapInstance(updated)));
});

router.post("/instances/:instanceId/renew", async (req, res): Promise<void> => {
  const params = RenewBotInstanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = currentUserId(res);
  await ensureWalletAccount(userId);
  const [instance] = await db
    .select()
    .from(botInstancesTable)
    .where(
      and(
        eq(botInstancesTable.id, params.data.instanceId),
        eq(botInstancesTable.clerkUserId, userId),
      ),
    )
    .limit(1);
  if (!instance) {
    res.status(404).json({ error: "Bot not found." });
    return;
  }

  const reference = `renew-${instance.id}-${Date.now()}`;
  const startFrom = Math.max(instance.renewalAt?.getTime() ?? 0, Date.now());
  const renewalAt = new Date(startFrom + BILLING_PERIOD_DAYS * MS_PER_DAY);
  const renewed = await db.transaction(async (tx) => {
    const [charged] = await tx
      .update(walletAccountsTable)
      .set({
        balanceKsh: sql`${walletAccountsTable.balanceKsh} - ${MONTHLY_PRICE_KSH}`,
      })
      .where(
        and(
          eq(walletAccountsTable.clerkUserId, userId),
          gte(walletAccountsTable.balanceKsh, MONTHLY_PRICE_KSH),
        ),
      )
      .returning({ clerkUserId: walletAccountsTable.clerkUserId });
    if (!charged) return false;
    await tx.insert(walletTransactionsTable).values({
      clerkUserId: userId,
      kind: "debit",
      status: "completed",
      amountKsh: MONTHLY_PRICE_KSH,
      description: `Monthly renewal — ${instance.templateName}`,
      reference,
    });
    await tx
      .update(botInstancesTable)
      .set({ renewalAt, status: instance.status === "past_due" ? "running" : instance.status })
      .where(eq(botInstancesTable.id, instance.id));
    await tx.insert(activitiesTable).values({
      clerkUserId: userId,
      title: "Bot renewed",
      detail: `${instance.name} is funded through ${renewalAt.toLocaleDateString("en-KE")}.`,
      kind: "renewal",
    });
    return true;
  });
  if (!renewed) {
    res.status(402).json({ error: `Add KSh ${MONTHLY_PRICE_KSH} to your wallet to renew.` });
    return;
  }
  if (instance.status === "past_due" && instance.herokuAppId) {
    await startHerokuApp(instance.herokuAppId);
  }
  const [updated] = await db
    .select()
    .from(botInstancesTable)
    .where(eq(botInstancesTable.id, instance.id))
    .limit(1);
  res.json(RenewBotInstanceResponse.parse(mapInstance(updated)));
});

async function runRenewalSweep(): Promise<void> {
  const due = await db
    .select()
    .from(botInstancesTable)
    .where(
      and(
        eq(botInstancesTable.status, "running"),
        lt(botInstancesTable.renewalAt, new Date()),
      ),
    );
  for (const instance of due) {
    const currentRenewalAt = instance.renewalAt;
    if (!currentRenewalAt) continue;
    const reference = `auto-renew-${instance.id}-${currentRenewalAt.getTime()}`;
    const result = await db.transaction(async (tx) => {
      const [ledgerEntry] = await tx
        .insert(walletTransactionsTable)
        .values({
          clerkUserId: instance.clerkUserId,
          kind: "debit",
          status: "pending",
          amountKsh: MONTHLY_PRICE_KSH,
          description: `Monthly renewal — ${instance.templateName}`,
          reference,
        })
        .onConflictDoNothing()
        .returning({ id: walletTransactionsTable.id });
      if (!ledgerEntry) return "already_processed" as const;

      const [account] = await tx
        .update(walletAccountsTable)
        .set({
          balanceKsh: sql`${walletAccountsTable.balanceKsh} - ${MONTHLY_PRICE_KSH}`,
        })
        .where(
          and(
            eq(walletAccountsTable.clerkUserId, instance.clerkUserId),
            gte(walletAccountsTable.balanceKsh, MONTHLY_PRICE_KSH),
          ),
        )
        .returning({ clerkUserId: walletAccountsTable.clerkUserId });

      if (!account) {
        await tx
          .update(walletTransactionsTable)
          .set({ status: "failed" })
          .where(eq(walletTransactionsTable.id, ledgerEntry.id));
        await tx
          .update(botInstancesTable)
          .set({ status: "past_due" })
          .where(eq(botInstancesTable.id, instance.id));
        await tx.insert(activitiesTable).values({
          clerkUserId: instance.clerkUserId,
          title: "Bot renewal is due",
          detail: `Add KSh ${MONTHLY_PRICE_KSH} to your wallet to keep ${instance.name} online.`,
          kind: "renewal",
        });
        return "past_due" as const;
      }

      const nextRenewalAt = new Date(
        currentRenewalAt.getTime() + BILLING_PERIOD_DAYS * MS_PER_DAY,
      );
      await tx
        .update(walletTransactionsTable)
        .set({ status: "completed" })
        .where(eq(walletTransactionsTable.id, ledgerEntry.id));
      await tx
        .update(botInstancesTable)
        .set({ renewalAt: nextRenewalAt })
        .where(eq(botInstancesTable.id, instance.id));
      await tx.insert(activitiesTable).values({
        clerkUserId: instance.clerkUserId,
        title: "Bot renewed automatically",
        detail: `${instance.name} is funded through ${nextRenewalAt.toLocaleDateString("en-KE")}.`,
        kind: "renewal",
      });
      return "renewed" as const;
    });
    if (result === "past_due" && instance.herokuAppId) {
      await stopHerokuApp(instance.herokuAppId).catch(() => undefined);
    }
  }
}

setInterval(() => {
  void runRenewalSweep().catch((error: unknown) => {
    // Scheduled work has no request context, and session/payment data is never logged.
    import("../lib/logger").then(({ logger }) =>
      logger.error(
        { message: error instanceof Error ? error.message : "unknown" },
        "Wallet renewal sweep failed",
      ),
    );
  });
}, 60 * 60 * 1000).unref();

export default router;
