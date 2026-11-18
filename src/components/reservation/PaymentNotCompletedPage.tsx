/**
 * Payment Not Completed conversion page. Copy and layout follow the approved
 * mockup (t429u). Live counts and photos are passed in; missing values are
 * hidden, never invented. Reserve restarts the real $50 Checkout.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/site/Logo";
import { representativePhoto } from "@/lib/marketing-fleet";
import {
  COMPANY_EMAIL,
  COMPANY_PHONE_DISPLAY,
  COMPANY_PHONE_E164,
  PICKUP_ADDRESS,
  availableCarsLine,
  displayView,
  linkExpiryLabel,
  openSlotsThisWeekLine,
  reserveLabel,
  stickyReserveVisible,
  type PaymentNotCompletedView,
} from "@/lib/payment-not-completed";
import "./PaymentNotCompletedPage.css";

export function PaymentNotCompletedPage({
  view,
  onReserve,
  reserving = false,
  error = null,
  now,
}: {
  view: PaymentNotCompletedView | null;
  onReserve?: () => void | Promise<void>;
  reserving?: boolean;
  error?: string | null;
  now?: Date;
}) {
  const d = displayView(view);
  const expiry = linkExpiryLabel(d.linkExpiresAt, now ?? new Date());
  const photos = d.vehicle?.photos ?? [];
  const generic = d.vehicle ? representativePhoto(d.vehicle.bodyType) : null;
  const gallery = photos.length ? photos : generic ? [generic] : [];
  const realGallery = photos.length > 0;
  const showCar = Boolean(d.vehicle && gallery.length > 0);
  const urgencyCount =
    (d.availableCars != null && d.city ? 1 : 0) +
    (d.openSlotsThisWeek != null ? 1 : 0) +
    1;

  const heroCtaRef = useRef<HTMLDivElement>(null);
  const finalCtaRef = useRef<HTMLElement>(null);
  const [showSticky, setShowSticky] = useState(false);

  useEffect(() => {
    const hero = heroCtaRef.current;
    const final = finalCtaRef.current;
    if (!hero || !final || typeof IntersectionObserver === "undefined") return;
    let heroInView = true;
    let finalInView = false;
    const sync = () => setShowSticky(stickyReserveVisible(heroInView, finalInView));
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === hero) heroInView = entry.isIntersecting;
        else if (entry.target === final) finalInView = entry.isIntersecting;
      }
      sync();
    });
    io.observe(hero);
    io.observe(final);
    return () => io.disconnect();
  }, []);

  return (
    <div className={`pnc${showSticky ? " pnc-has-sticky" : ""}`} data-testid="reservation-fee-return-canceled">
      <header className="pnc-header">
        <div className="pnc-header-inner">
          <Logo href={false} />
        </div>
      </header>

      <section className="pnc-hero">
        <div className="pnc-hero-inner">
          <div className="pnc-status-pill">
            <WarnIcon />
            Payment Not Completed
          </div>
          <p className="pnc-kicker">You've Already Done The Hard Part</p>
          <h1>Your Car Isn't Reserved Yet</h1>
          <p className="pnc-subhead">
            You're approved, and you've already signed. One step is left: the ${d.amount} Reservation Fee.
            {d.vehicle ? (
              <>
                {" "}Your <strong>{d.vehicle.label}</strong> is not held until you pay — cars go to whoever reserves first.
              </>
            ) : (
              <> Your car is not held until you pay — cars go to whoever reserves first.</>
            )}
          </p>
          <div ref={heroCtaRef} data-testid="pnc-hero-cta">
            <Cta amount={d.amount} checkoutUrl={d.checkoutUrl} processing={d.processing} onReserve={onReserve} reserving={reserving} expiry={expiry} error={error} size="lg" />
          </div>
        </div>
      </section>

      <section className="pnc-insurance" aria-labelledby="insurance-heading">
        <div className="pnc-insurance-card">
          <p className="pnc-insurance-kicker">
            <ShieldIcon />
            Included In Your Weekly Price
          </p>
          <h2 id="insurance-heading">Insurance Included At <em>$0 Extra</em></h2>
          <p>
            We pay your full first month of insurance upfront, so we only reserve cars for drivers who are serious about renting and earning. We're investing in your safety, and your ${d.amount} shows you're ready. It's applied to your first week's rent, so it's not an extra cost.
          </p>
          <span className="pnc-insurance-chip">Maintenance Included Too</span>
        </div>
      </section>

      <section className="pnc-urgency" aria-label="Live availability">
        <div className="pnc-urgency-inner" data-count={urgencyCount}>
          {d.availableCars != null && d.city ? (
            <article className="pnc-stat">
              <div className="pnc-stat-label-row">
                <span className="pnc-stat-kicker">In Your City</span>
              </div>
              <p className="pnc-stat-value pnc-stat-value-accent">{availableCarsLine(d.availableCars, d.city)}</p>
              <p>Inventory changes as other approved drivers reserve first.</p>
            </article>
          ) : null}
          {d.openSlotsThisWeek != null ? (
            <article className="pnc-stat">
              <div className="pnc-stat-label-row">
                <span className="pnc-stat-kicker">This Week</span>
              </div>
              <p className="pnc-stat-value">{openSlotsThisWeekLine(d.openSlotsThisWeek)}</p>
              <p>Monday through Friday at 9:30, 10:30, and 11:30 AM.</p>
            </article>
          ) : null}
          <article className="pnc-stat">
            <div className="pnc-stat-label-row">
              <span className="pnc-stat-kicker">First Come, First Served</span>
            </div>
            <p className="pnc-stat-value">This Car Isn't Held Until You Pay</p>
            <p>It goes back on the market right away. Other approved drivers can reserve it as soon as they pay the ${d.amount} Reservation Fee.</p>
          </article>
        </div>
      </section>

      <div className="pnc-wrap">
        {showCar && d.vehicle ? (
          <section className="pnc-block" aria-labelledby="car-heading" data-testid="pnc-your-car">
            <h2 id="car-heading">Your Car</h2>
            <p className="pnc-lead">This is the car you signed for. Pay the ${d.amount} Reservation Fee to hold it.</p>
            <Gallery label={d.vehicle.label} photos={gallery} real={realGallery} />
          </section>
        ) : null}

        <section className="pnc-block" aria-labelledby="fee-heading">
          <p className="pnc-section-kicker">A Smart Move</p>
          <h2 id="fee-heading">What Your ${d.amount} Does</h2>
          <p className="pnc-lead pnc-fee-lead">The Reservation Fee holds your car and is applied in full to week 1. It isn't an extra charge.</p>
          <div className="pnc-cards">
            <article className="pnc-card">
              <div className="pnc-icon-bubble"><PinIcon /></div>
              <h3>Holds Your Specific Car</h3>
              <p>Your signed car is reserved for you, not the next approved driver who is ready to pay.</p>
            </article>
            <article className="pnc-card">
              <div className="pnc-icon-bubble pnc-icon-bubble-green"><DollarIcon /></div>
              <h3>Applied 100% To Week 1</h3>
              <p>The full ${d.amount} comes straight off your first week's rent.</p>
            </article>
            <article className="pnc-card">
              <div className="pnc-icon-bubble"><ClockIcon /></div>
              <h3>Choose Your Pickup Time</h3>
              <p>As soon as you pay, you can choose an open weekday slot.</p>
            </article>
          </div>
        </section>

        <section className="pnc-block" aria-labelledby="next-heading">
          <h2 id="next-heading">Here's Exactly What Happens After You Pay</h2>
          <div className="pnc-timeline">
            <div className="pnc-step">
              <div className="pnc-num">1</div>
              <div>
                <h3>You Pick Your Pickup Time</h3>
                <p>Open slots are Monday through Friday at 9:30, 10:30, and 11:30 AM.</p>
              </div>
            </div>
            <div className="pnc-step">
              <div className="pnc-num">2</div>
              <div>
                <h3>We Get You Ready For Pickup</h3>
                <p>We'll text you with next steps and everything you need for pickup day.</p>
              </div>
            </div>
            <div className="pnc-step">
              <div className="pnc-num">3</div>
              <div>
                <h3>You Start Driving This Week</h3>
                <p>Bring your driver's license and the phone you drive with. The rest of week 1 is charged at pickup, minus your ${d.amount}.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="pnc-block" aria-labelledby="trust-heading">
          <h2 id="trust-heading">Why This Is A Safe Next Step</h2>
          <div className="pnc-trust-row">
            <article className="pnc-trust-item">
              <CalendarIcon />
              <div>
                <h3>No Long-Term Lock-In</h3>
                <p>After the 4-week minimum, you can continue week to week.</p>
              </div>
            </article>
            <article className="pnc-trust-item">
              <LockIcon />
              <div>
                <h3>Secure Stripe Checkout</h3>
                <p>We never see your full card number. Payment is handled by Stripe.</p>
              </div>
            </article>
            <article className="pnc-trust-item">
              <HomeIcon />
              <div>
                <h3>Built For Uber And Lyft Drivers</h3>
                <p>The process is set up so you can get a reliable car and start earning this week.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="pnc-block" aria-labelledby="faq-heading">
          <h2 id="faq-heading">Questions Drivers Ask</h2>
          <div className="pnc-faq-list">
            <details className="pnc-faq" open>
              <summary>Is This Legit?</summary>
              <p className="pnc-faq-body">Yes. Real Rentals is a local Tampa company at {PICKUP_ADDRESS}. Your ${d.amount} is paid through Stripe's secure checkout — we never see your full card number.</p>
            </details>
            <details className="pnc-faq">
              <summary>When Is My Card Charged For The Rest?</summary>
              <p className="pnc-faq-body">Only the ${d.amount} Reservation Fee is charged now, and it's applied in full to week 1. The remaining first week's rent is charged to your card on file on pickup day.</p>
            </details>
            <details className="pnc-faq" id="faq-something-goes-wrong">
              <summary>What If Something Goes Wrong?</summary>
              <p className="pnc-faq-body">Refundable If We Can't Get You On The Road.</p>
            </details>
            <details className="pnc-faq">
              <summary>Can I Pay Later?</summary>
              <p className="pnc-faq-body">Your checkout link stays good for 23 hours, so you can come back and pay anytime before it expires. The car is not held until the ${d.amount} is paid — other approved drivers can reserve it in the meantime.</p>
            </details>
          </div>
        </section>

        <section className="pnc-final" id="reserve" aria-labelledby="final-heading" ref={finalCtaRef}>
          <p className="pnc-section-kicker">A Smart Move</p>
          <h2 id="final-heading">Reserve Your Car Before Someone Else Does</h2>
          <p className="pnc-lead">You've already been approved and you've already signed. Pay the ${d.amount} Reservation Fee now to hold your car and pick your pickup time.</p>
          <Cta amount={d.amount} checkoutUrl={d.checkoutUrl} processing={d.processing} onReserve={onReserve} reserving={reserving} expiry={expiry} error={error} size="lg" terms />
        </section>
      </div>

      <footer className="pnc-foot">
        Real Rentals · {PICKUP_ADDRESS}<br />
        <a href={`tel:${COMPANY_PHONE_E164}`}>{COMPANY_PHONE_DISPLAY}</a>
        {" · "}
        <a href={`mailto:${COMPANY_EMAIL}`}>{COMPANY_EMAIL}</a>
      </footer>

      <div
        className={`pnc-sticky${showSticky ? " pnc-sticky-visible" : ""}`}
        aria-label="Reserve your car"
        data-testid="pnc-sticky"
        hidden={!showSticky}
      >
        <Cta amount={d.amount} checkoutUrl={d.checkoutUrl} processing={d.processing} onReserve={onReserve} reserving={reserving} expiry={expiry} error={null} size="md" />
      </div>
    </div>
  );
}

function Cta({
  amount, checkoutUrl, processing, onReserve, reserving, expiry, error, size, terms,
}: {
  amount: number;
  checkoutUrl: string | null;
  processing: boolean;
  onReserve?: () => void | Promise<void>;
  reserving: boolean;
  expiry: string;
  error: string | null;
  size: "lg" | "md";
  terms?: boolean;
}) {
  const label = reserveLabel(amount);
  const cls = `pnc-btn pnc-btn-primary${size === "lg" ? " pnc-btn-lg" : ""}`;
  let action: ReactNode;
  if (processing) {
    action = <p className="pnc-cta-error">Your Reservation Fee is processing. This page will update once it goes through.</p>;
  } else if (checkoutUrl) {
    action = <a className={cls} href={checkoutUrl}>{label}</a>;
  } else if (onReserve) {
    action = <button type="button" className={cls} onClick={() => void onReserve()} disabled={reserving}>{reserving ? "Opening Checkout…" : label}</button>;
  } else {
    action = <p className="pnc-cta-error">To finish, use the Pay Reservation Fee button in your Agreement Signed email. The link works for 23 hours after signing.</p>;
  }
  return (
    <div className="pnc-hero-actions">
      {action}
      {!processing && (checkoutUrl || onReserve) ? (
        <div className="pnc-btn-note">
          <span className="pnc-applied-line">100% Applied To Your First Week's Rent</span>
          <span className="pnc-expiry">{expiry}</span>
        </div>
      ) : null}
      {error ? <p className="pnc-cta-error">{error}</p> : null}
      {terms ? <p className="pnc-see-terms"><a href="#faq-something-goes-wrong">See Terms</a></p> : null}
    </div>
  );
}

function Gallery({ label, photos, real }: { label: string; photos: string[]; real: boolean }) {
  const [active, setActive] = useState(0);
  const src = photos[Math.min(active, photos.length - 1)] ?? photos[0];
  return (
    <div className="pnc-gallery">
      <div className="pnc-gallery-head">
        <h3>{label}</h3>
      </div>
      <img className="pnc-hero-photo" src={src} alt={real ? `${label}` : `Representative photo for ${label}`} />
      {photos.length > 1 ? (
        <div className="pnc-thumbs">
          {photos.map((p, i) => (
            <button
              key={`${p}-${i}`}
              type="button"
              className={`pnc-thumb${i === active ? " pnc-thumb-active" : ""}`}
              onClick={() => setActive(i)}
              aria-label={`Photo ${i + 1}`}
              aria-pressed={i === active}
            >
              <img src={p} alt="" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8.2V12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
      <path d="M12.9 3.8l8.3 14.6A1.1 1.1 0 0 1 20.3 20H3.7a1.1 1.1 0 0 1-1-1.6L11.1 3.8a1.1 1.1 0 0 1 1.8 0Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.6 19.2 6.4v5.3c0 4.4-3 7.6-7.2 9.1-4.2-1.5-7.2-4.7-7.2-9.1V6.4L12 3.6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8.6 12.1 11 14.5 15.6 9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 13.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M19.2 11c-.8 4.2-4 8.5-7.2 10.5C8.8 19.5 5.6 15.2 4.8 11A7.2 7.2 0 0 1 12 3.8 7.2 7.2 0 0 1 19.2 11Z" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function DollarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.2v9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9.4 9.2c.3-1 1.3-1.6 2.6-1.6 1.6 0 2.6.8 2.6 2 0 2.7-5 1.4-5 4.1 0 1.2 1.1 2.1 2.8 2.1 1.4 0 2.4-.7 2.8-1.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.8V12l3.2 1.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="5.5" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 3.5V7.5M16 3.5V7.5M4.5 10h15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="10" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 16.5h16M5.5 16.5V9.5l6.5-4 6.5 4v7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 16.5v-4h5v4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
