// Read-only SMS provider check (Twilio). GET requests only; never sends a
// message, never returns credentials, account ids or phone numbers.
import type { SmsCheck } from "@/lib/automations-overview.functions";

type Env = Record<string, string | undefined>;

export async function runSmsSetupCheck(env: Env, fetchFn: typeof fetch): Promise<SmsCheck> {
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER, svc = env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token) return { status: "not_set_up", detail: "SMS account settings are missing on the server." };
  if (!from && !svc) return { status: "sender_missing", detail: "No sending number or messaging service is set on the server." };
  const auth = "Basic " + btoa(`${sid}:${token}`);
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}`;
  try {
    const acct = await fetchFn(`${base}.json`, { method: "GET", headers: { authorization: auth } });
    if (acct.status === 401 || acct.status === 403) return { status: "rejected", detail: "The SMS provider rejected the saved account settings." };
    if (!acct.ok) return { status: "unreachable", detail: "The SMS provider did not answer normally. Try again later." };
    const a = (await acct.json().catch(() => ({}))) as { status?: string };
    if (a.status && a.status !== "active") return { status: "rejected", detail: "The SMS account is not active." };
    if (svc) {
      const r = await fetchFn(`https://messaging.twilio.com/v1/Services/${encodeURIComponent(svc)}`, { method: "GET", headers: { authorization: auth } });
      if (!r.ok) return { status: "sender_missing", detail: "The saved messaging service was not found on the account." };
    } else if (from) {
      const r = await fetchFn(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`, { method: "GET", headers: { authorization: auth } });
      const j = (await r.json().catch(() => ({}))) as { incoming_phone_numbers?: unknown[] };
      if (!r.ok || !j.incoming_phone_numbers?.length) return { status: "sender_missing", detail: "The saved sending number is not on the account." };
    }
    return { status: "ok", detail: "SMS account and sender check out. No message was sent." };
  } catch {
    return { status: "unreachable", detail: "Could not reach the SMS provider. Try again later." };
  }
}
