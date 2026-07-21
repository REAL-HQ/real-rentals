import { Link, useRouterState } from "@tanstack/react-router";
import { Check, Mail, MapPin, Clock, Headphones, Wrench, Infinity as InfinityIcon, Zap, Wallet } from "lucide-react";
import { Logo } from "./Logo";

const trustBar = [
  { label: "No Credit Check", Icon: Check },
  { label: "No Deposit", Icon: Wallet },
  { label: "Unlimited Miles", Icon: InfinityIcon },
  { label: "24/7 Driver Support", Icon: Headphones },
  { label: "Maintenance Included", Icon: Wrench },
  { label: "Same Day Approval", Icon: Zap },
];

const badges = [
  "No Credit Check",
  "No Deposit",
  "Unlimited Miles",
  "24/7 Driver Support",
  "Maintenance Included",
  "Same Day Approval",
];

const driverLinks = [
  { to: "/fleet", label: "Fleet" },
  { to: "/how-it-works", label: "How It Works" },
  { to: "/apply", label: "Get My Quote" },
  { to: "/faq", label: "FAQ" },
  { to: "/how-it-works", label: "Requirements" },
];

const ownerLinks: { to: string; label: string; hash?: string }[] = [
  { to: "/partners", label: "How It Works" },
  { to: "/partners", hash: "faq", label: "Owner FAQ" },
];

export function Footer() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const matches = useRouterState({ select: (s) => s.matches });
  const isPartners = pathname === "/partners";
  const isCity = matches.some((m) => m.routeId === "/$slug");
  return (
    <footer className={isPartners || isCity ? "" : "mt-24"}>
      {!isPartners && (
      <div className="border-y border-border bg-soft">
        <div className="container-real py-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs md:text-sm text-foreground/80">
          {trustBar.map(({ label, Icon }) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <Icon className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />
              <span className="font-medium">{label}</span>
            </span>
          ))}
        </div>
      </div>
      )}
      {!(isPartners || isCity) && (
      <div className="bg-real-red text-white">
        <div className="container-real py-14 md:py-20 flex flex-col items-center gap-8 text-center">
          <div>
            <div className="text-3xl md:text-5xl font-semibold leading-tight">Need A Vehicle To Start Driving This Week?</div>
            <div className="mt-3 text-base md:text-lg text-white/90">Get A Quote In Minutes. Get Approved Fast. Start Earning.</div>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 shrink-0">
            <Link
              to="/apply"
              className="inline-flex items-center justify-center rounded-lg bg-white text-real-red px-10 py-5 text-base md:text-lg font-bold shadow-xl hover:scale-[1.03] hover:shadow-2xl transition active:scale-95 whitespace-nowrap"
            >
              Get My Quote →
            </Link>
            <Link
              to="/partners"
              className="inline-flex items-center justify-center rounded-lg border border-white/40 text-white px-6 py-3 text-sm font-medium hover:bg-white/10 transition active:scale-95"
            >
              Become A Partner
            </Link>
          </div>
        </div>
      </div>
      )}
      <div className="container-real py-14 grid grid-cols-1 md:grid-cols-12 gap-10 text-sm">
        <div className="md:col-span-4">
          <Logo width={110} offset={false} />
          <p className="mt-5 text-muted-foreground max-w-sm">
            Rideshare-Ready Vehicles For Uber,<br />Lyft, DoorDash & Delivery Work.
          </p>
          <ul className="mt-5 space-y-2">
            {badges.map((b) => (
              <li key={b} className="flex items-center gap-2 text-foreground/80">
                <Check className="w-4 h-4 text-real-red" strokeWidth={2.5} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-2">
          <div className="text-[11px] tracking-[0.2em] font-semibold text-muted-foreground uppercase mb-4">Drivers</div>
          <ul className="space-y-2 text-muted-foreground">
            {driverLinks.map((l, i) => (
              <li key={`${l.label}-${i}`}>
                <Link to={l.to} className="hover:text-foreground transition-colors">{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-3">
          <div className="text-[11px] tracking-[0.2em] font-semibold text-muted-foreground uppercase mb-4">Fleet Owners</div>
          <ul className="space-y-2 text-muted-foreground">
            {ownerLinks.map((l, i) => (
              <li key={`${l.label}-${i}`}>
                <Link to={l.to} hash={l.hash} className="hover:text-foreground transition-colors">{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-3">
          <div className="text-[11px] tracking-[0.2em] font-semibold text-muted-foreground uppercase mb-4">Contact</div>
          <ul className="space-y-3 text-muted-foreground">
            <li className="flex items-center gap-2"><Mail className="w-4 h-4" /> <a href="mailto:go@drivereal.com" className="hover:text-foreground">go@drivereal.com</a></li>
            <li className="flex items-center gap-2"><MapPin className="w-4 h-4" /> Tampa, Florida</li>
            <li className="flex items-center gap-2"><Clock className="w-4 h-4" /> Mon–Sat, 9am – 7pm</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-real py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>© 2026 REAL RENTALS. All Rights Reserved.</div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms Of Service</Link>
            <Link to="/sms-consent" className="hover:text-foreground transition-colors">SMS Consent</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}