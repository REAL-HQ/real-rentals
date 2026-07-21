import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | REAL RENTALS" },
      { name: "description", content: "How REAL RENTALS collects, uses, and protects the personal information you share with us." },
      { property: "og:title", content: "Privacy Policy | REAL RENTALS" },
      { property: "og:description", content: "How REAL RENTALS collects, uses, and protects the personal information you share with us." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <SiteLayout>
      <section className="container-real py-14 md:py-20 max-w-3xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">Legal</div>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: June 2026</p>

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
              <li>To send service updates and, with your consent, marketing communications.</li>
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
            <p className="mt-3">You can opt out of marketing emails at any time using the unsubscribe link. To request access, correction, or deletion of your data, email <a href="mailto:privacy@realrentals.com" className="text-real-red underline">privacy@realrentals.com</a>.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">SMS Messaging</h2>
            <p className="mt-3">See our <Link to="/sms-consent" className="text-real-red underline">SMS Consent Policy</Link> for details on text messaging.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Contact</h2>
            <p className="mt-3">Questions? Email <a href="mailto:go@drivereal.com" className="text-real-red underline">go@drivereal.com</a>.</p>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}