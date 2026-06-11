import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

const links = [
  { to: "/fleet", label: "Fleet" },
  { to: "/how-it-works", label: "How It Works" },
  { to: "/faq", label: "FAQ" },
  { to: "/investors", label: "Investors" },
  { to: "/contact", label: "Contact" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        scrolled
          ? "bg-white/80 backdrop-blur-md border-b border-border"
          : "bg-white border-b border-transparent"
      }`}
    >
      <div className="container-real flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-1 text-[15px] tracking-[0.18em]">
          <span className="font-semibold">REAL</span>
          <span className="font-normal text-foreground">AUTOMOTIVE</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-[13px] text-muted-foreground">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden md:block">
          <Link
            to="/apply"
            className="inline-flex items-center rounded-lg bg-real-red px-5 py-2 text-sm font-medium text-white hover:opacity-90 active:scale-95 transition"
          >
            Apply Now
          </Link>
        </div>
        <button
          className="md:hidden p-2 -mr-2"
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>
      {open && (
        <div className="md:hidden border-t border-border bg-white">
          <div className="container-real py-4 flex flex-col gap-4">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="text-sm py-2"
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            ))}
            <Link
              to="/apply"
              onClick={() => setOpen(false)}
              className="inline-flex justify-center rounded-lg bg-real-red px-5 py-3 text-sm font-medium text-white"
            >
              Apply Now
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}