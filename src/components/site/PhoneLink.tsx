import type { ReactNode } from "react";
import { useBusinessPhone } from "@/lib/company.functions";
import { getAttribution } from "@/lib/attribution";

export type CallPlacement = "header" | "hero" | "application_help" | "contact" | "footer" | "paid_landing";

/**
 * Records a click on a phone link. A click is not a call and never a
 * conversion — it is sent once, as `click_to_call`, through the existing gtag
 * (if loaded), with the session's first-touch UTM context. gclid is not sent.
 */
export function trackCallClick(placement: CallPlacement, phoneE164: string) {
  if (typeof window === "undefined") return;
  const gtag = (window as any).gtag;
  if (typeof gtag !== "function") return;
  const a = getAttribution();
  const path = window.location.pathname;
  gtag("event", "click_to_call", {
    page_path: path,
    page_type: path === "/" ? "home" : path.startsWith("/apply") ? "application" : path.split("/")[1] || "home",
    phone_number: phoneE164,
    placement,
    campaign_source: a.utm_source ?? undefined,
    campaign_medium: a.utm_medium ?? undefined,
    campaign_name: a.utm_campaign ?? undefined,
  });
}

/** Click-to-call link bound to Settings → Company → Business Phone. */
export function PhoneLink({
  placement,
  className,
  children,
  ariaLabel,
}: {
  placement: CallPlacement;
  className?: string;
  /** Render prop gets the formatted number; defaults to the number itself. */
  children?: (display: string) => ReactNode;
  ariaLabel?: string;
}) {
  const phone = useBusinessPhone();
  return (
    <a
      href={phone.tel}
      onClick={() => trackCallClick(placement, phone.e164)}
      aria-label={ariaLabel ?? `Call REAL RENTALS at ${phone.display}`}
      className={className}
    >
      {children ? children(phone.display) : phone.display}
    </a>
  );
}
