import { Link } from "@tanstack/react-router";
import { Check, Phone, Mail, MapPin, Clock, Shield, Wrench, BadgeCheck, Infinity as InfinityIcon, Zap } from "lucide-react";

const trustBar = [
  { label: "Uber/Lyft Eligible", Icon: BadgeCheck },
  { label: "No Credit Check", Icon: Check },
  { label: "Insurance Included", Icon: Shield },
  { label: "Maintenance Included", Icon: Wrench },
  { label: "Unlimited Miles", Icon: InfinityIcon },
  { label: "Same Day Approval", Icon: Zap },
];

const badges = [
  "Insurance Included",
  "Maintenance Included",
  "Unlimited Miles",
  "24/7 Support",
];

const driverLinks = [
  { to: "/fleet", label: "Fleet" },
  { to: "/how-it-works", label: "How It Works" },
  { to: "/apply", label: "Apply" },
  { to: "/faq", label: "FAQ" },
  { to: "/how-it-works", label: "Requirements" },
];

const investorLinks = [
  { to: "/investors", label: "Become A Fleet Partner" },
  { to: "/investors", label: "Earn Passive Income" },
  { to: "/faq", label: "Investor FAQ" },
  { to: "/investors", label: "Fleet Management" },
];

export function Footer() {
  return (
    <footer className="mt-24">
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
      <div className="bg-real-red text-white">
        <div className="container-real py-12 md:py-16 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
          <div>
            <div className="text-2xl md:text-3xl font-semibold">Need A Vehicle To Start Driving This Week?</div>
            <div className="mt-2 text-sm md:text-base text-white/85">Apply in minutes. Get approved fast. Start earning.</div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to="/apply"
              className="inline-flex items-center justify-center rounded-lg bg-white text-foreground px-7 py-3 text-sm font-medium hover:bg-soft transition active:scale-95"
            >
              Apply Now
            </Link>
            <Link
              to="/investors"
              className="inline-flex items-center justify-center rounded-lg border border-white/40 text-white px-7 py-3 text-sm font-medium hover:bg-white/10 transition active:scale-95"
            >
              Become A Partner
            </Link>
          </div>
        </div>
      </div>
      <div className="container-real py-14 grid grid-cols-1 md:grid-cols-12 gap-10 text-sm">
        <div className="md:col-span-4">
          <div className="text-foreground font-semibold tracking-tight text-lg">REAL AUTOMOTIVE</div>
          <p className="mt-3 text-muted-foreground max-w-sm">
            Rideshare-ready vehicles for Uber, Lyft, DoorDash and Instacart drivers.
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
          <div className="text-[11px] tracking-[0.2em] font-semibold text-muted-foreground uppercase mb-4">Investors</div>
          <ul className="space-y-2 text-muted-foreground">
            {investorLinks.map((l, i) => (
              <li key={`${l.label}-${i}`}>
                <Link to={l.to} className="hover:text-foreground transition-colors">{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-3">
          <div className="text-[11px] tracking-[0.2em] font-semibold text-muted-foreground uppercase mb-4">Contact</div>
          <ul className="space-y-3 text-muted-foreground">
            <li className="flex items-center gap-2"><Phone className="w-4 h-4" /> <a href="tel:+18135550100" className="hover:text-foreground">(813) 555-0100</a></li>
            <li className="flex items-center gap-2"><Mail className="w-4 h-4" /> <a href="mailto:hello@realautomotive.com" className="hover:text-foreground">hello@realautomotive.com</a></li>
            <li className="flex items-center gap-2"><MapPin className="w-4 h-4" /> Tampa, Florida</li>
            <li className="flex items-center gap-2"><Clock className="w-4 h-4" /> Mon–Sat, 9am – 7pm</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-real py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>© {new Date().getFullYear()} REAL AUTOMOTIVE. All rights reserved.</div>
          <div className="flex gap-5">
            <Link to="/contact" className="hover:text-foreground">Contact</Link>
            <Link to="/faq" className="hover:text-foreground">FAQ</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}