import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./Logo";

const menuLinks = [
  { to: "/fleet", label: "Fleet" },
  { to: "/apply", label: "Apply" },
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
      className={`sticky top-0 z-50 w-full relative transition-all duration-300 ${
        scrolled
          ? "bg-white/80 backdrop-blur-md border-b border-border"
          : "bg-white border-b border-transparent"
      }`}
    >
      <div className="flex h-12 items-center justify-between px-[3%]">
        <Logo />
        <div className="flex items-center gap-3">
          <Link
            to="/apply"
            className="inline-flex items-center rounded-lg bg-real-red px-4 py-2 text-[13px] font-medium text-white hover:bg-red-700 transition active:scale-95"
          >
            Apply
          </Link>
          <button
            className="p-2 -mr-2"
            onClick={() => setOpen((o) => !o)}
            aria-label="Menu"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-transparent"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-3 top-[calc(100%+6px)] z-50 w-56 rounded-xl border border-border bg-white shadow-xl overflow-hidden">
            <nav className="flex flex-col py-2">
              {menuLinks.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  className="px-4 py-2.5 text-sm text-foreground hover:bg-soft transition-colors"
                  onClick={() => setOpen(false)}
                >
                  {l.label}
                </Link>
              ))}
              <div className="px-3 pt-2 pb-3">
                <Link
                  to="/apply"
                  onClick={() => setOpen(false)}
                  className="inline-flex w-full justify-center rounded-lg bg-real-red px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 transition active:scale-95"
                >
                  Apply Now
                </Link>
              </div>
            </nav>
          </div>
        </>
      )}
    </header>
  );
}