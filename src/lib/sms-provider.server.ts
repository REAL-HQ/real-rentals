// Which SMS provider the server will use, read from env at request time.
//
// Quo (formerly OpenPhone) wins whenever QUO_API_KEY is set; Twilio stays as
// the fallback so nothing changes for an environment that only has Twilio.
// SMS_DRY_RUN=true makes every send log what it would have sent and never
// touch the network, so a new key can be checked before anyone is texted.
//
// Never returns secret values — only whether they are present.

type Env = Record<string, string | undefined>;

/** REAL Rentals inbox, (888) 833-8280. Overridable with QUO_PHONE_NUMBER_ID. */
export const QUO_DEFAULT_PHONE_NUMBER_ID = "PNrZULvFMn";

export type QuoSender = { id: string; label: string; display: string; e164: string };

/**
 * The only Quo numbers the app may text from (confirmed in Quo, Nov 9 2026).
 * QUO_FROM_NUMBERS (comma-separated PN ids) can narrow this list on the
 * server; it can never add a number that is not here.
 */
export const QUO_KNOWN_SENDERS: readonly QuoSender[] = [
  { id: "PNrZULvFMn", label: "REAL Rentals", display: "(888) 833-8280", e164: "+18888338280" },
  { id: "PNcX8a0PLJ", label: "Primary", display: "(813) 212-4174", e164: "+18132124174" },
];

/** Allowlisted senders, default first. */
export function quoSenders(env?: Env): QuoSender[] {
  const e = envOf(env);
  const raw = String(e.QUO_FROM_NUMBERS ?? "").trim();
  const wanted = raw ? new Set(raw.split(",").map((v) => v.trim()).filter(Boolean)) : null;
  const list = QUO_KNOWN_SENDERS.filter((s) => !wanted || wanted.has(s.id));
  const allowed = list.length ? list : QUO_KNOWN_SENDERS.filter((s) => s.id === QUO_DEFAULT_PHONE_NUMBER_ID);
  const def = quoSenderIn(allowed, e);
  return [...allowed.filter((s) => s.id === def), ...allowed.filter((s) => s.id !== def)];
}

function quoSenderIn(allowed: readonly QuoSender[], e: Env): string {
  const v = String(e.QUO_PHONE_NUMBER_ID ?? "").trim();
  if (allowed.some((s) => s.id === v)) return v;
  if (allowed.some((s) => s.id === QUO_DEFAULT_PHONE_NUMBER_ID)) return QUO_DEFAULT_PHONE_NUMBER_ID;
  return allowed[0].id;
}

/** Resolve a requested sender id; null means "not allowed". Missing request → default. */
export function resolveQuoSender(requested: string | null | undefined, env?: Env): QuoSender | null {
  const list = quoSenders(env);
  if (requested == null || requested === "") return list[0];
  return list.find((s) => s.id === requested) ?? null;
}

/** Map one of our numbers (E.164) or a PN id back to its allowlisted sender. */
export function quoSenderFor(value: string | null | undefined, env?: Env): QuoSender | null {
  if (!value) return null;
  return quoSenders(env).find((s) => s.id === value || s.e164 === value) ?? null;
}

export type SmsProviderStatus = {
  provider: "quo" | "twilio" | "none";
  /** A provider has every setting it needs to send. */
  ready: boolean;
  dryRun: boolean;
  /** Quo phone number id (PN…) or Twilio number/service; never a secret. */
  sender: string | null;
  senderKind: "number" | "messaging_service" | "none";
};

function envOf(env?: Env): Env {
  return env ?? (process.env as Env);
}

export function smsDryRun(env?: Env): boolean {
  const v = String(envOf(env).SMS_DRY_RUN ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Default sending number id (always on the allowlist). */
export function quoSender(env?: Env): string {
  return quoSenders(env)[0].id;
}

export function smsProviderStatus(env?: Env): SmsProviderStatus {
  const e = envOf(env);
  const dryRun = smsDryRun(e);
  if (String(e.QUO_API_KEY ?? "").trim()) {
    return { provider: "quo", ready: true, dryRun, sender: quoSender(e), senderKind: "number" };
  }
  const sid = e.TWILIO_ACCOUNT_SID, token = e.TWILIO_AUTH_TOKEN;
  const from = e.TWILIO_FROM_NUMBER, svc = e.TWILIO_MESSAGING_SERVICE_SID;
  if (sid || token || from || svc) {
    return {
      provider: "twilio",
      ready: Boolean(sid && token && (from || svc)),
      dryRun,
      sender: svc ?? from ?? null,
      senderKind: svc ? "messaging_service" : from ? "number" : "none",
    };
  }
  return { provider: "none", ready: false, dryRun, sender: null, senderKind: "none" };
}

/** True when texts can be sent (or dry-run logged) by some provider. */
export function smsConfigured(env?: Env): boolean {
  return smsProviderStatus(env).ready;
}
