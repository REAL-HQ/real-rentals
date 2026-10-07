import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | REAL RENTALS" },
      { name: "description", content: "How REAL RENTALS collects, uses, and protects the personal information you share with us." },
      { property: "og:title", content: "Privacy Policy | REAL RENTALS" },
      { property: "og:description", content: "How REAL RENTALS collects, uses, and protects the personal information you share with us." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://drivereal.com/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <SiteLayout>
      <section className="container-real py-14 md:py-20 max-w-3xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">Legal</div>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: October 2026</p>

        <div className="mt-10 space-y-8 text-foreground/85 leading-relaxed">
          <p>This Privacy Policy explains how REAL RENTALS ("we", "us", "our") collects, uses, and shares information when you visit our website or submit an application for a rental.</p>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Information We Collect</h2>
            <ul className="mt-3 list-disc pl-6 space-y-1.5">
              <li>Contact details you provide (name, phone, email, city).</li>
              <li>Application details such as gig-platform status and rental timeline.</li>
              <li>Technical data (IP address, device, browser, referring URL, UTM parameters).</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">How We Use Information</h2>
            <ul className="mt-3 list-disc pl-6 space-y-1.5">
              <li>To respond to quote requests and process rental applications.</li>
              <li>To send service updates by email and, with your consent, marketing emails.</li>
              <li>To improve our website, services, and advertising performance.</li>
              <li>To comply with legal obligations and prevent fraud.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Sharing</h2>
            <p className="mt-3">We do not sell your personal information. We share data with service providers (hosting, analytics, communications) under contract, and with rental partners only as needed to fulfill your request.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Your Choices</h2>
            <p className="mt-3">You can opt out of marketing emails at any time using the unsubscribe link. To request access, correction, or deletion of your data, email <a href="mailto:privacy@drivereal.com" className="text-real-red underline">privacy@drivereal.com</a>.</p>
          </div>

          <div id="sms" className="scroll-mt-24">
            <h2 className="text-xl font-semibold text-foreground">SMS / Mobile Information</h2>
            <ul className="mt-3 list-disc pl-6 space-y-1.5">
              <li>If you check the optional SMS box on our application, REAL RENTALS may use the mobile number you provide to send transactional and customer-care text messages about your application, rental, payments, vehicle pickup and return, service, and support. We do not send promotional text messages.</li>
              <li>Mobile information and SMS opt-in consent will not be sold or shared with third parties or affiliates for their marketing or promotional purposes.</li>
              <li>We may share mobile information with service providers and subcontractors (for example, our messaging provider) only as necessary to deliver these messages.</li>
              <li>SMS opt-in consent data is not used for any unrelated purpose.</li>
              <li>Reply STOP to opt out or HELP for help at any time. See our <Link to="/terms" hash="sms" className="text-real-red underline">SMS Terms</Link> and <Link to="/sms-consent" className="text-real-red underline">SMS Consent Policy</Link>.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Contact</h2>
            <p className="mt-3">Questions? Email <a href="mailto:team@drivereal.com" className="text-real-red underline">team@drivereal.com</a>.</p>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}