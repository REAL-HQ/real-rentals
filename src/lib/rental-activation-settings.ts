// Owner-only rental activation settings. Client-safe: names and the one parse rule.
//
// Stored in the existing public.app_settings table under RENTAL_ACTIVATION_SETTINGS_KEY.
// The value is written only by public.set_rental_activation_insurance_exception
// (proposed/activation-insurance-setting): it checks private.is_owner() and writes the
// audit row in the same transaction. A missing row, a missing field, a non-boolean or an
// unreadable row all read as OFF.

export const RENTAL_ACTIVATION_SETTINGS_KEY = "rental_activation";
export const ALLOW_WITHOUT_INSURANCE_FIELD = "allow_activation_without_insurance_verification";
export const ALLOW_WITHOUT_INSURANCE_LABEL = "Allow Activation Without Insurance Verification";

/** true only for an explicit boolean true; everything else is OFF. */
export function readAllowWithoutInsurance(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>)[ALLOW_WITHOUT_INSURANCE_FIELD] === true;
}

export type RentalActivationSettings = {
  allowWithoutInsuranceVerification: boolean;
  /** The settings row exists. */
  present: boolean;
  /** The row could be read; false means it was treated as OFF. */
  readable: boolean;
};
