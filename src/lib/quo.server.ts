// Server-only Quo (formerly OpenPhone) API client.
//
// Docs: https://www.quo.com/docs/2026-03-30/messages/send-a-message
//   POST https://api.quo.com/messages
//   Authorization: <API key>          (no "Bearer" prefix)
//   Quo-Api-Version: 2026-03-30       (required, no default)
//   { content, from: "PN…", to: ["+1…"] }  → 202 { data: { id: "AC…", status } }
//
// The API key is read from the environment by the caller and never logged or
// returned. Only sms.server.ts sendSms should call sendQuoMessage, so consent,
// opt-out, dedupe and the send log always apply.

export const QUO_API_BASE = "https://api.quo.com";
export const QUO_API_VERSION = "2026-03-30";
/** Quo rejects longer content; SMS segments past this would be refused anyway. */
export const QUO_MAX_CONTENT = 1600;
const QUO_TIMEOUT_MS = 10_000;
const RATE_LIMIT_RETRY_MS = 1_200;

export type QuoSendResult =
  | { ok: true; id: string | null; status: string | null }
  | {
      ok: false;
      error: string;
      httpStatus: number | null;
      /** Quo says the recipient opted out (STOP). */
      optedOut?: boolean;
      /** The recipient number itself is bad or unreachable. */
      badNumber?: boolean;
      /** Quo may have accepted it (timeout / network drop) — do not resend blindly. */
      uncertain?: boolean;
    };

type QuoSendArgs = {
  apiKey: string;
  from: string;
  to: string;
  content: string;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  /** Test hook so the rate-limit retry does not really wait. */
  sleep?: (ms: number) => Promise<void>;
};

function readTitle(payload: any): string {
  return String(payload?.title ?? payload?.error?.key ?? "").trim();
}

function readMessage(payload: any, status: number): string {
  const m = payload?.message ?? payload?.error?.message;
  const title = readTitle(payload);
  const text = [title, m].filter(Boolean).join(": ");
  return (text || `HTTP ${status}`).slice(0, 300);
}

/**
 * Send one text through Quo. Retries exactly once, only on a per-second rate
 * limit (429 "Too Many Requests"), because that response means Quo did not
 * accept the message. 5xx, timeouts and network errors are never retried
 * here: Quo may already have queued the text, and a second POST would
 * double-text the renter.
 */
export async function sendQuoMessage(args: QuoSendArgs): Promise<QuoSendResult> {
  const fetchFn = args.fetchFn ?? fetch;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const content = args.content.trim();
  if (!content) return { ok: false, error: "empty message", httpStatus: null };
  if (content.length > QUO_MAX_CONTENT) {
    return { ok: false, error: `message is longer than ${QUO_MAX_CONTENT} characters`, httpStatus: null };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const timeout = AbortSignal.timeout(QUO_TIMEOUT_MS);
    const signal = args.signal ? AbortSignal.any([timeout, args.signal]) : timeout;
    let res: Response;
    try {
      res = await fetchFn(`${QUO_API_BASE}/messages`, {
        method: "POST",
        headers: {
          Authorization: args.apiKey,
          "Quo-Api-Version": QUO_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, from: args.from, to: [args.to] }),
        signal,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const timedOut = name === "TimeoutError" || name === "AbortError";
      return {
        ok: false,
        error: timedOut ? "Quo did not answer in time; check Quo before resending" : "could not reach Quo; check Quo before resending",
        httpStatus: null,
        uncertain: true,
      };
    }

    const payload = (await res.json().catch(() => ({}))) as any;
    if (res.ok) {
      return { ok: true, id: payload?.data?.id ?? null, status: payload?.data?.status ?? null };
    }

    const title = readTitle(payload);
    if (res.status === 429 && attempt === 0 && !/daily/i.test(title) && String(payload?.code ?? "") !== "0200429") {
      await sleep(RATE_LIMIT_RETRY_MS);
      continue;
    }
    const code = String(payload?.code ?? "");
    return {
      ok: false,
      error: readMessage(payload, res.status),
      httpStatus: res.status,
      optedOut: code === "0201400" || /opted out/i.test(title),
      badNumber: code === "0202400" || code === "0203400" || /`to` phone number/i.test(title),
      uncertain: res.status >= 500 ? true : undefined,
    };
  }
  return { ok: false, error: "Quo rate limit reached; try again shortly", httpStatus: 429 };
}

/** Read-only check that the key works and can see the sending number. Never sends. */
export async function checkQuoSetup(apiKey: string, phoneNumberId: string, fetchFn: typeof fetch = fetch): Promise<"ok" | "rejected" | "sender_missing" | "unreachable"> {
  try {
    const res = await fetchFn(`${QUO_API_BASE}/phone-numbers/${encodeURIComponent(phoneNumberId)}`, {
      method: "GET",
      headers: { Authorization: apiKey, "Quo-Api-Version": QUO_API_VERSION },
      signal: AbortSignal.timeout(QUO_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return "rejected";
    if (res.status === 404) return "sender_missing";
    return res.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

// ---------------------------------------------------------------------------
// Webhook signature (Standard Webhooks / Svix scheme):
//   base64(HMAC-SHA256(base64decode(secret without "whsec_"), `${id}.${ts}.${rawBody}`))
// sent as space-separated "v1,<sig>" entries in webhook-signature.
// https://www.quo.com/docs/2026-03-30/webhooks-signature-validation
// ---------------------------------------------------------------------------

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signQuoWebhook(secret: string, id: string, timestamp: string, rawBody: string): Promise<string> {
  const keyB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = await crypto.subtle.importKey("raw", b64ToBytes(keyB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

export async function verifyQuoWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_WEBHOOK_AGE_SECONDS) return false;
  let expected: string;
  try {
    expected = await signQuoWebhook(secret, id, timestamp, rawBody);
  } catch {
    return false;
  }
  return signature
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((entry) => {
      const [version, sig] = entry.split(",");
      return version === "v1" && !!sig && constantTimeEqual(sig, expected);
    });
}
