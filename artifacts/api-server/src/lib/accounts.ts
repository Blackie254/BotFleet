import { eq } from "drizzle-orm";
import { db, walletAccountsTable } from "@workspace/db";

type ClerkUserResponse = {
  primary_email_address_id?: string | null;
  email_addresses?: Array<{
    id: string;
    email_address: string;
    verification?: { status?: string | null } | null;
  }>;
};

async function getClerkUser(userId: string): Promise<ClerkUserResponse> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("Account authentication is not configured.");
  const response = await fetch(
    `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Could not retrieve the signed-in account.");
  }
  return (await response.json()) as ClerkUserResponse;
}

export async function getVerifiedAccountEmail(userId: string): Promise<string> {
  const user = await getClerkUser(userId);
  const email = user.email_addresses?.find(
    (item) =>
      item.id === user.primary_email_address_id &&
      item.verification?.status === "verified",
  ) ?? user.email_addresses?.find((item) => item.verification?.status === "verified");
  if (!email) {
    throw new Error("Verify an email address on your account before adding wallet funds.");
  }
  return email.email_address;
}

export async function ensureWalletAccount(userId: string) {
  const [current] = await db
    .select()
    .from(walletAccountsTable)
    .where(eq(walletAccountsTable.clerkUserId, userId))
    .limit(1);
  if (current) return current;

  const user = await getClerkUser(userId);
  const email =
    user.email_addresses?.find((item) => item.id === user.primary_email_address_id)
      ?.email_address ??
    user.email_addresses?.[0]?.email_address ??
    null;
  const [account] = await db
    .insert(walletAccountsTable)
    .values({ clerkUserId: userId, email })
    .onConflictDoNothing()
    .returning();
  if (account) return account;
  const [concurrentAccount] = await db
    .select()
    .from(walletAccountsTable)
    .where(eq(walletAccountsTable.clerkUserId, userId))
    .limit(1);
  if (!concurrentAccount) throw new Error("Could not initialize the wallet.");
  return concurrentAccount;
}
