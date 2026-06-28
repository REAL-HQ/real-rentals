import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms Of Service | REAL RENTALS" },
      { name: "description", content: "The terms that govern your use of REAL RENTALS's website and rental application services." },
      { property: "og:title", content: "Terms Of Service | REAL RENTALS" },
      { property: "og:description", content: "The terms that govern your use of REAL RENTALS's website and rental application services." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <SiteLayout>
      <section className="container-real py-14 md:py-20 max-w-3xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">Legal</div>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold">Terms Of Service</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: June 2026</p>

        <div className="mt-10 space-y-8 text-foreground/85 leading-relaxed">
          <p>By accessing this website or submitting an application, you agree to these Terms of Service.</p>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Eligibility</h2>
            <p className="mt-3">You must be at least 21 years old and hold a valid U.S. driver's license to apply for a rental. Approval is subject to verification and partner availability.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Quotes And Applications</h2>
            <p className="mt-3">Quotes are estimates only and not a guarantee of approval, vehicle availability, or pricing. Final terms are provided in the rental agreement executed at pickup.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Platform Affiliation</h2>
            <p className="mt-3">REAL RENTALS is not affiliated with Uber, Lyft, DoorDash, Instacart, Amazon Flex, or any other gig platform. Platform eligibility depends on each platform's own rules.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Acceptable Use</h2>
            <p className="mt-3">You agree not to misuse this site, attempt to gain unauthorized access, or submit false information.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">No Deposit & Card On File</h2>
            <p className="mt-3">REAL RENTALS does not collect a security deposit. By signing your rental agreement, you authorize REAL RENTALS to keep a valid payment card on file and to charge that card for tolls, tickets, citations, damage, cleaning, and unpaid rent incurred during your rental, as described in the Rental Agreement. The card on file is an incidentals authorization — it is not a deposit and is not pre-charged at booking. Payment card data is securely tokenized through our payment processor; raw card numbers are not stored by REAL RENTALS.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Tolls, Tickets & Charges</h2>
            <p className="mt-3">The renter is responsible for all tolls, tickets, citations, and traffic or parking violations incurred during the rental period. For any unpaid item, REAL RENTALS will identify the renter to the issuing authority under the rental agreement — in Florida, via the affidavit process under Fla. Stat. § 316.1001 — transferring the citation to the renter. An administrative fee may apply per notice and may be charged to the payment card on file.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Insurance</h2>
            <p className="mt-3">Insurance options are available with every rental. Coverage terms, limits, exclusions, and the named insured party are described in your rental agreement and any insurance enrollment documents. Coverage during commercial or rideshare use depends on the option selected; ask our team for current details before you sign.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Disclaimers</h2>
            <p className="mt-3">The site is provided "as is" without warranties of any kind. To the maximum extent permitted by law, REAL RENTALS disclaims all liability for damages arising from your use of the site.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Changes</h2>
            <p className="mt-3">We may update these terms at any time. Continued use of the site after changes constitutes acceptance.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground">Contact</h2>
            <p className="mt-3">Questions? See our <Link to="/privacy" className="text-real-red underline">Privacy Policy</Link> or email <a href="mailto:legal@realrentals.com" className="text-real-red underline">legal@realrentals.com</a>.</p>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}