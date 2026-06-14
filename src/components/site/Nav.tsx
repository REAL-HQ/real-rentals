import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, User, LogOut, Shield } from "lucide-react";
import { Logo } from "./Logo";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const menuLinks = [
  { to: "/fleet", label: "Fleet" },
  { to: "/how-it-works", label: "How It Works" },
  { to: "/faq", label: "FAQ" },
  { to: "/partners", label: "Partners" },
  { to: "/contact", label: "Contact" },
];

export function Nav() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAuthReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
  }

  return (
    <header
      className={`sticky top-0 z-50 w-full relative transition-all duration-300 ${
        scrolled
          ? "bg-white/80 backdrop-blur-md border-b border-border"
          : "bg-white border-b border-transparent"
      }`}
    >
      <div className="flex h-12 items-center justify-between px-[3%]">
        {location.pathname !== "/admin" && <Logo />}
        <div className="flex items-center gap-3 ml-auto">
          {!authReady ? (
            <div className="h-8 w-24" aria-hidden />
          ) : session ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="hidden sm:inline-flex items-center justify-center h-8 px-3 rounded-lg bg-soft text-foreground hover:bg-muted transition gap-2 text-[13px]"
                  aria-label="Profile"
                >
                  <User className="w-4 h-4" />
                  <span className="font-medium">Profile</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{session.user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/admin" className="cursor-pointer flex items-center gap-2 w-full">
                    <Shield className="w-4 h-4" />
                    Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-real-red focus:text-real-red flex items-center gap-2">
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              to="/admin"
              className="hidden sm:inline-flex items-center text-[13px] font-medium text-muted-foreground hover:text-foreground transition"
            >
              Log In
            </Link>
          )}
          {authReady && !session && (
            <Link
              to="/apply"
              className="inline-flex items-center rounded-lg bg-real-red px-4 py-2 text-[13px] font-medium text-white hover:bg-red-700 transition active:scale-95"
            >
              Apply
            </Link>
          )}
          {authReady && !session && (
            <button
              className="p-2 -mr-2"
              onClick={() => setOpen((o) => !o)}
              aria-label="Menu"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}
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
              {!session && (
                <div className="px-3 pt-2 pb-3">
                  <Link
                    to="/apply"
                    onClick={() => setOpen(false)}
                    className="inline-flex w-full justify-center rounded-lg bg-real-red px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 transition active:scale-95"
                  >
                    Apply Now
                  </Link>
                </div>
              )}
            </nav>
          </div>
        </>
      )}
    </header>
  );
}