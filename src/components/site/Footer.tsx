import { Link } from "@tanstack/react-router";

const groups = [
  {
    title: "Drive",
    links: [
      { to: "/fleet", label: "Fleet" },
      { to: "/how-it-works", label: "How It Works" },
      { to: "/apply", label: "Apply" },
    ],
  },
  {
    title: "Company",
    links: [
      { to: "/investors", label: "Investors" },
      { to: "/faq", label: "FAQ" },
      { to: "/contact", label: "Contact" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border mt-24">
      <div className="bg-real-red text-white">
        <div className="container-real py-12 md:py-16 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
          <div>
            <div className="text-2xl md:text-3xl font-semibold">Your Next Paycheck Is Parked Here.</div>
            <div className="mt-2 text-sm md:text-base text-white/85">Apply in minutes. Drive this week.</div>
          </div>
          <Link
            to="/apply"
            className="inline-flex items-center rounded-lg bg-white text-foreground px-7 py-3 text-sm font-medium hover:bg-soft transition active:scale-95"
          >
            Apply Now
          </Link>
        </div>
      </div>
      <div className="container-real py-14 grid grid-cols-2 md:grid-cols-4 gap-10 text-sm">
        <div className="col-span-2 md:col-span-2">
          <div className="flex items-center gap-1 tracking-[0.18em]">
            <span className="font-semibold">REAL</span>
            <span className="font-normal">AUTOMOTIVE</span>
          </div>
          <p className="mt-3 text-muted-foreground max-w-sm">
            Rideshare-ready vehicles for Uber, Lyft, and delivery drivers. Apply in
            minutes — drive this week.
          </p>
        </div>
        {groups.map((g) => (
          <div key={g.title}>
            <div className="text-foreground font-medium mb-3">{g.title}</div>
            <ul className="space-y-2 text-muted-foreground">
              {g.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-foreground transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="container-real py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>© {new Date().getFullYear()} REAL AUTOMOTIVE. All rights reserved.</div>
          <div>A Real Advisors Company.</div>
        </div>
      </div>
    </footer>
  );
}