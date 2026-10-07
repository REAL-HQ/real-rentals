/**
 * The REAL RENTALS company phone — browser-safe helpers.
 *
 * Source of truth is Settings → Company → Business Phone
 * (app_settings.system_preferences.business_phone). The default below is only
 * the fallback for when that setting is empty or unreadable, and the value
 * static markup (JSON-LD) is built from. Never type the number into a page:
 * read it through useBusinessPhone() or getBusinessPhone() (server).
 *
 * This is a human-readable number. A telecom provider's internal number id
 * belongs in a provider record, never here.
 */
export const DEFAULT_BUSINESS_PHONE = "+18888338280";

/** E.164 for a US number, or null. Mirrors sms.server toE164 for US input. */
export function businessPhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

/** "(888) 833-8280" */
export function formatBusinessPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return e164;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export type BusinessPhone = { e164: string; display: string; tel: string };

export function toBusinessPhone(raw: string | null | undefined): BusinessPhone {
  const e164 = businessPhoneE164(raw) ?? DEFAULT_BUSINESS_PHONE;
  return { e164, display: formatBusinessPhone(e164), tel: `tel:${e164}` };
}
