import { createHmac, timingSafeEqual } from "node:crypto";

type PaystackEnvelope<T> = {
  status: boolean;
  message?: string;
  data: T;
};

export type PaystackTransaction = {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  metadata?: unknown;
};

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error("Paystack is not configured.");
  }
  return key;
}

export function verifyPaystackSignature(payload: Buffer, signature: string): boolean {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", key).update(payload).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(expected, received);
}

async function request<T>(
  path: string,
  options: { method: "GET" | "POST"; body?: Record<string, unknown> },
): Promise<T> {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const envelope = (await response.json().catch(() => null)) as
    | PaystackEnvelope<T>
    | null;
  if (!response.ok || !envelope?.status || envelope.data == null) {
    throw new Error(`Paystack request failed (${response.status}).`);
  }
  return envelope.data;
}

export function initializePaystackTransaction(input: {
  email: string;
  amountKsh: number;
  reference: string;
  callbackUrl: string;
  userId: string;
}) {
  return request<{ authorization_url: string; reference: string }>(
    "/transaction/initialize",
    {
      method: "POST",
      body: {
        email: input.email,
        amount: input.amountKsh * 100,
        currency: "KES",
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: JSON.stringify({
          userId: input.userId,
          walletReference: input.reference,
          purpose: "wallet_topup",
        }),
      },
    },
  );
}

export function verifyPaystackTransaction(reference: string) {
  return request<PaystackTransaction>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );
}
