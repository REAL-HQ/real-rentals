import { COMPANY_DEFAULTS } from "@/lib/agreement-merge";
import { getBusinessPhone } from "@/lib/company.server";

/**
 * Company identity for agreements. Authoritative source: Settings → Company
 * (app_settings.system_preferences: company_name, mailing_address,
 * business_phone, support_email). `missing` lists what Settings lacks; until
 * filled, generation keeps the current wording's legacy values so existing
 * sending is not broken — but template approval is refused (see
 * agreement-templates.functions.ts). Nothing here is invented.
 */
export type CompanyIdentity = {
  merge: { company_name: string; company_address: string; company_phone: string; company_email: string };
  missing: string[];
  fromSettings: Record<"company_name" | "company_address" | "company_phone" | "company_email", boolean>;
};

export async function getCompanyIdentity(admin: any): Promise<CompanyIdentity> {
  let v: any = {};
  try {
    const { data } = await admin.from("app_settings").select("value").eq("key", "system_preferences").maybeSingle();
    v = data?.value ?? {};
  } catch { /* fall through: everything reported missing */ }
  const name = String(v.company_name ?? "").trim();
  const addr = String(v.mailing_address ?? "").trim();
  const email = String(v.support_email ?? "").trim();
  const phoneSet = !!String(v.business_phone ?? "").trim();
  const phone = (await getBusinessPhone(admin)).display;
  const missing: string[] = [];
  if (!name) missing.push("Legal Business Name");
  if (!addr) missing.push("Mailing Address");
  else if (!/\d/.test(addr) || !/\b\d{5}(-\d{4})?\b/.test(addr)) missing.push("Mailing Address (needs street number and ZIP)");
  if (!phoneSet) missing.push("Business Phone");
  if (!email.includes("@")) missing.push("Support Email");
  return {
    merge: {
      company_name: name || String(COMPANY_DEFAULTS.company_name),
      company_address: addr || String(COMPANY_DEFAULTS.company_address),
      company_phone: phone,
      company_email: email.includes("@") ? email : String(COMPANY_DEFAULTS.company_email),
    },
    missing,
    fromSettings: { company_name: !!name, company_address: !!addr, company_phone: phoneSet, company_email: email.includes("@") },
  };
}
