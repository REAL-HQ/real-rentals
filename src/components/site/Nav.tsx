import { Link, useLocation, useMatch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, User, LogOut, Shield, MessageSquare, Bell, HelpCircle, Car, Handshake, BookOpen, Rocket, MessageCircle, Mail } from "lucide-react";
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
  const [roles, setRoles] = useState<string[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

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

  useEffect(() => {
    if (!session) {
      setRoles([]);
      setUnreadMessages(0);
      setUnreadNotifications(0);
      return;
    }
    const uid = session.user.id;
    let cancelled = false;
    (async () => {
      const [rolesRes, msgRes, notifRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("recipient_id", uid)
          .eq("read", false),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .or(`driver_id.eq.${uid},user_id.eq.${uid}`)
          .eq("read", false),
      ]);
      if (cancelled) return;
      setRoles((rolesRes.data ?? []).map((r: any) => r.role));
      setUnreadMessages(msgRes.count ?? 0);
      setUnreadNotifications(notifRes.count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
  }

  const isDriver = roles.includes("driver");
  const isPartner = roles.includes("partner");
  const isAdmin = roles.includes("admin") || roles.includes("team");
  const accountHref = isAdmin ? "/admin" : isPartner ? "/partner" : isDriver ? "/portal" : "/admin";
  const accountLabel = isPartner ? "Partner Portal" : isDriver ? "Driver Portal" : "Account";

  return (
    <header
      className={`sticky top-0 z-50 w-full relative transition-all duration-300 ${
        scrolled
          ? "bg-white/80 backdrop-blur-md border-b border-border"
          : "bg-white border-b border-transparent"
      }`}
    >
      <div className="flex h-12 items-center justify-between px-[3%]">
        <div className="flex items-center gap-4">
          {location.pathname !== "/admin" && <Logo />}
        </div>
        <div className="flex items-center gap-3">
          {authReady && session ? (
            <>
              {(isPartner || isDriver) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="inline-flex items-center justify-center h-9 w-9 text-muted-foreground hover:text-foreground transition"
                      aria-label="Help"
                    >
                      <HelpCircle className="w-[18px] h-[18px]" strokeWidth={1.8} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-white">
                    <DropdownMenuItem className="cursor-pointer flex items-center gap-2" onClick={() => toast.info("Help center coming soon.")}>
                      <HelpCircle className="w-4 h-4" />
                      Help
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer flex items-center gap-2" onClick={() => toast.info("Tour coming soon.")}>
                      <Rocket className="w-4 h-4" />
                      Tour
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer flex items-center gap-2" onClick={() => toast.info("Tutorials coming soon.")}>
                      <BookOpen className="w-4 h-4" />
                      Tutorial
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer flex items-center gap-2" onClick={() => toast.info("Feedback coming soon.")}>
                      <MessageCircle className="w-4 h-4" />
                      Feedback
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {isAdmin ? (
                <Link to="/admin" search={{ tab: "messages" }} className="relative inline-flex items-center justify-center h-9 w-9 text-muted-foreground hover:text-foreground transition" aria-label={`Messages${unreadMessages > 0 ? ` (${unreadMessages} unread)` : ""}`}>
                  <MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.8} />
                  {unreadMessages > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-real-red text-white text-[11px] font-semibold flex items-center justify-center leading-none">
                      {unreadMessages > 9 ? "9+" : unreadMessages}
                    </span>
                  )}
                </Link>
              ) : (
                <IconBadgeButton ariaLabel="Messages" count={unreadMessages} onClick={() => toast.info("Messages inbox is coming online with the messaging panel.")}>
                  <MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.8} />
                </IconBadgeButton>
              )}
              <IconBadgeButton ariaLabel="Notifications" count={unreadNotifications} onClick={() => toast.info("Notification center is coming online shortly.")}>
                <Bell className="w-[18px] h-[18px]" strokeWidth={1.8} />
              </IconBadgeButton>
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="hidden sm:inline-flex items-center justify-center h-9 w-9 rounded-full border-2 border-real-red bg-white text-muted-foreground hover:text-foreground transition"
                  aria-label="Profile"
                >
                  <User className="w-[18px] h-[18px]" strokeWidth={1.8} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    {session.user.user_metadata?.full_name && (
                      <p className="text-sm font-semibold">{session.user.user_metadata.full_name}</p>
                    )}
                    <p className="text-sm text-muted-foreground">{session.user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={accountHref} className="cursor-pointer flex items-center gap-2 w-full">
                    {isAdmin ? <Shield className="w-4 h-4" /> : isPartner ? <Handshake className="w-4 h-4" /> : <Car className="w-4 h-4" />}
                    {accountLabel}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-real-red focus:text-real-red flex items-center gap-2">
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </>
          ) : !session ? (
            <Link
              to="/admin"
              className="hidden sm:inline-flex items-center text-[13px] font-medium text-muted-foreground hover:text-foreground transition"
            >
              Log In
            </Link>
          ) : null}
          {!session && (
            <Link
              to="/apply"
              className="inline-flex items-center rounded-lg bg-real-red px-4 py-2 text-[13px] font-medium text-white hover:bg-red-700 transition active:scale-95"
            >
              Book Now
            </Link>
          )}
          {!session && (
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
                    Book Now
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

function IconBadgeButton({
  ariaLabel,
  count,
  onClick,
  children,
}: {
  ariaLabel: string;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${ariaLabel}${count > 0 ? ` (${count} unread)` : ""}`}
      className="relative inline-flex items-center justify-center h-9 w-9 text-muted-foreground hover:text-foreground transition"
    >
      {children}
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-real-red text-white text-[11px] font-semibold flex items-center justify-center leading-none">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}