import { toBusinessPhone, type BusinessPhone } from "@/lib/company";

/**
 * Server read of Settings → Company → Business Phone. Falls back to the
 * default when the setting is blank or the read fails — a missing setting
 * must never print an empty phone into an email, agreement or HELP reply.
 */
export async function getBusinessPhone(admin?: any): Promise<BusinessPhone> {
  try {
    const client =
      admin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const { data } = await client
      .from("app_settings")
      .select("value")
      .eq("key", "system_preferences")
      .maybeSingle();
    return toBusinessPhone((data?.value as any)?.business_phone ?? null);
  } catch {
    return toBusinessPhone(null);
  }
}
