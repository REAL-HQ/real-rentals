import {
  RENTAL_ACTIVATION_SETTINGS_KEY,
  readAllowWithoutInsurance,
  type RentalActivationSettings,
} from "@/lib/rental-activation-settings";

/**
 * Reads the Owner setting with the service-role client. Never throws: a
 * missing or unreadable setting is OFF (fail closed). The activation
 * transaction re-reads it under a FOR SHARE lock; this read only informs the
 * readiness screen and the server's first decision.
 */
type SettingsReader = {
  from: (table: "app_settings") => {
    select: (cols: string) => {
      eq: (
        col: string,
        v: string,
      ) => {
        maybeSingle: () => PromiseLike<{ data: { value: unknown } | null; error: unknown }>;
      };
    };
  };
};

export async function loadRentalActivationSettings(
  admin: unknown,
): Promise<RentalActivationSettings> {
  try {
    const { data, error } = await (admin as SettingsReader)
      .from("app_settings")
      .select("value")
      .eq("key", RENTAL_ACTIVATION_SETTINGS_KEY)
      .maybeSingle();
    if (error) return { allowWithoutInsuranceVerification: false, present: false, readable: false };
    if (!data) return { allowWithoutInsuranceVerification: false, present: false, readable: true };
    return {
      allowWithoutInsuranceVerification: readAllowWithoutInsurance(data.value),
      present: true,
      readable: true,
    };
  } catch {
    return { allowWithoutInsuranceVerification: false, present: false, readable: false };
  }
}
