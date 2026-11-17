import { Link } from "@tanstack/react-router";
import { SMS_CONSENT_LABEL } from "@/lib/sms-consent";
import { CheckboxInput } from "@/components/ui/checkbox-input";

/**
 * Optional, unchecked-by-default SMS opt-in. Separate from any Terms
 * acceptance; leaving it unchecked never blocks submission.
 * Disclosure text mirrors SMS_CONSENT_DISCLOSURE in src/lib/sms-consent.ts.
 *
 * The checkbox is a normal 18px box (CheckboxInput) aligned with the first line of the
 * label. The whole label (box + wording) is the tap target, so it stays
 * comfortable on a phone without a 44px-tall visual box.
 */
export function SmsConsentField({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="flex items-start gap-3 cursor-pointer">
        <CheckboxInput
          name="sms_consent"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          boxClassName="mt-px"
          aria-describedby="sms-consent-disclosure"
        />
        <span className="text-sm leading-snug text-foreground">
          {SMS_CONSENT_LABEL} <span className="text-muted-foreground">(Optional)</span>
        </span>
      </label>
      <p id="sms-consent-disclosure" className="mt-2 pl-[30px] text-xs leading-relaxed text-muted-foreground">
        By checking this box, you agree to receive recurring transactional SMS messages from REAL RENTALS
        at the mobile number provided. Message frequency varies. Message and data rates may apply. Reply
        STOP to opt out or HELP for help. Consent is not a condition of renting a vehicle. View our{" "}
        <Link to="/terms" hash="sms" className="whitespace-nowrap underline hover:text-foreground">Terms</Link>{" "}
        and{" "}
        <Link to="/privacy" hash="sms" className="whitespace-nowrap underline hover:text-foreground">Privacy Policy</Link>.
      </p>
    </div>
  );
}
