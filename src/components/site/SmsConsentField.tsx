import { Link } from "@tanstack/react-router";
import { SMS_CONSENT_LABEL } from "@/lib/sms-consent";

/**
 * Optional, unchecked-by-default SMS opt-in. Separate from any Terms
 * acceptance; leaving it unchecked never blocks submission.
 * Disclosure text mirrors SMS_CONSENT_DISCLOSURE in src/lib/sms-consent.ts.
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
      <label className="flex min-h-11 items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          name="sms_consent"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="size-11 accent-real-red shrink-0"
          aria-describedby="sms-consent-disclosure"
        />
        <span className="text-sm leading-snug text-foreground">
          {SMS_CONSENT_LABEL} <span className="text-muted-foreground">(Optional)</span>
        </span>
      </label>
      <p id="sms-consent-disclosure" className="mt-2 pl-14 text-xs leading-relaxed text-muted-foreground">
        By checking this box, you agree to receive recurring transactional SMS messages from REAL RENTALS
        at the mobile number provided. Message frequency varies. Message and data rates may apply. Reply
        STOP to opt out or HELP for help. Consent is not a condition of renting a vehicle. View our{" "}
        <Link to="/terms" hash="sms" className="underline hover:text-foreground box-decoration-clone px-2 -mx-2 pt-[10px] pb-[19px]">Terms</Link> and{" "}
        <Link to="/privacy" hash="sms" className="underline hover:text-foreground box-decoration-clone px-2 -mx-2 pt-[10px] pb-[19px]">Privacy Policy</Link>.
      </p>
    </div>
  );
}
