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

export function quoSender(env?: Env): string {
  const v = String(envOf(env).QUO_PHONE_NUMBER_ID ?? "").trim();
  return /^PN[A-Za-z0-9]+$/.test(v) ? v : QUO_DEFAULT_PHONE_NUMBER_ID;
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
