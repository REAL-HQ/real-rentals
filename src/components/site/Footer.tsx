import { Link } from "@tanstack/react-router";

const groups = [
  {
    title: "Drive",
    links: [
      { to: "/fleet", label: "Fleet" },
      { to: "/how-it-works", label: "How It Works" },
      { to: "/pricing", label: "Pricing" },
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