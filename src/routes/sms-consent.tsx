import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";

export const Route = createFileRoute("/sms-consent")({
  head: () => ({
    meta: [
      { title: "SMS Consent Policy | REAL RENTALS" },
      { name: "description", content: "How REAL RENTALS uses text messaging, opt-in/opt-out, message frequency, and carrier disclosures." },
      { property: "og:title", content: "SMS Consent Policy | REAL RENTALS" },
      { property: "og:description", content: "How REAL RENTALS uses text messaging, opt-in/opt-out, message frequency, and carrier disclosures." },
    ],
  }),
  component: SmsConsentPage,
});

function SmsConsentPage() {
  return (
    <SiteLayout>
      <section className="container-real py-14 md:py-20 max-w-3xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">Legal</div>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold">SMS Consent Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: June 2026</p>

        <div className="mt-10 space-y-8 text-foreground/85 leading-relaxed">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Opt-In</h2>
            <p className="mt-3">By submitting an application or quote request and checking the SMS consent box, you agree to receive text messages from REAL RENTALS at the mobile number you provide. Messages may include rental updates, application status, scheduling, and occasional promotions.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Message Frequency</h2>
            <p className="mt-3">Message frequency varies based on your activity. Message and data rates may apply.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Opt-Out</h2>
            <p className="mt-3">You can opt out at any time by replying <span className="font-semibold">STOP</span> to any message. For help, reply <span className="font-semibold">HELP</span> or email <a href="mailto:go@drivereal.com" className="text-real-red underline">go@drivereal.com</a>.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Carriers</h2>
            <p className="mt-3">Carriers are not liable for delayed or undelivered messages. Supported carriers include AT&T, T-Mobile, Verizon Wireless, Sprint, and most other major U.S. carriers.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Privacy</h2>
            <p className="mt-3">Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes. See our <Link to="/privacy" className="text-real-red underline">Privacy Policy</Link> for full details.</p>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}