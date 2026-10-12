type Admin = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

export const recoveryMaintenanceResponse = {
  maintenance: true as const,
  ok: false as const,
  error: "Applications, application recovery and Waitlist promotion are temporarily unavailable for maintenance. Your existing information is preserved. Please try again after maintenance; do not resubmit repeatedly.",
};

/** Uncached shared configuration, read before any workflow write. Unknown is closed. */
export async function recoveryEntryPaused(admin: Admin): Promise<boolean> {
  try {
    const { data, error } = await admin.from("app_settings").select("value")
      .eq("key", "recovery_cutover_maintenance").maybeSingle();
    if (error || !data || typeof data.value !== "object" || data.value === null || Array.isArray(data.value)) return true;
    return data.value.mode !== "open";
  } catch {
    return true;
  }
}
