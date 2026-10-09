const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

export async function sendRenewalReminder(input: {
  to: string;
  botName: string;
  renewalDate: Date;
  walletUrl: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return false;
  const botName = escapeHtml(input.botName);
  const renewalDate = escapeHtml(input.renewalDate.toLocaleDateString("en-KE", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi",
  }));
  const walletUrl = escapeHtml(input.walletUrl);
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: `Renew ${botName} before ${renewalDate} | BotCloud`,
      text: `Your WhatsApp bot ${input.botName} is due for renewal on ${renewalDate}. Top up your BotCloud wallet to keep it online: ${input.walletUrl}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#102a43"><h1 style="color:#0877ef">Keep ${botName} online</h1><p>Your bot's hosting period ends on <strong>${renewalDate}</strong>.</p><p>Top up your wallet before then to keep the deployment running.</p><p><a href="${walletUrl}" style="display:inline-block;background:#0877ef;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Open wallet</a></p><p style="color:#65758b;font-size:13px">You can review your balance and deployments in your BotCloud account.</p></div>`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Renewal reminder delivery failed (${response.status}).`);
  }
  await response.body?.cancel();
  return true;
}
