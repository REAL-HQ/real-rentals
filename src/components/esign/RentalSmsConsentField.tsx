import { RENTAL_SMS_CONSENT_TEXT } from "@/lib/sms-consent";
import { CheckboxInput } from "@/components/ui/checkbox-input";

/**
 * Transactional rental-text opt-in. The label is the exact sentence in
 * RENTAL_SMS_CONSENT_TEXT. The parent starts it checked and hides the field
 * entirely when consent is already on file.
 */
export function RentalSmsConsentField({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 text-left ${className}`}>
      <CheckboxInput
        name="rental_sms_consent"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        boxClassName="mt-0.5"
      />
      <span className="min-w-0 text-[14px] leading-5 text-[#111114]">{RENTAL_SMS_CONSENT_TEXT}</span>
    </label>
  );
}
