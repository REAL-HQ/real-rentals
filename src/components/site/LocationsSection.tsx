import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ArrowRight, X, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FadeUp } from "./FadeUp";

type LocationCard = {
  id: string;
  slug: string;
  market_id: string | null;
  city: string;
  status: string;
  hero_image_url: string | null;
  sort_order: number;
};

export function LocationsSection() {
  const [cards, setCards] = useState<LocationCard[]>([]);
  const [modalCard, setModalCard] = useState<LocationCard | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("sites")
        .select("id, slug, market_id, title, status, hero_image_url, sort_order, show_on_homepage, markets(name)")
        .eq("show_on_homepage", true)
        .order("sort_order", { ascending: true });
      const rows = (data ?? []) as any[];
      const mapped: LocationCard[] = rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        market_id: r.market_id,
        city: r.markets?.name ?? r.title,
        status: r.status ?? "coming_soon",
        hero_image_url: r.hero_image_url,
        sort_order: r.sort_order ?? 100,
      }));
      mapped.sort((a, b) => {
        if (a.status === "live" && b.status !== "live") return -1;
        if (b.status === "live" && a.status !== "live") return 1;
        return a.sort_order - b.sort_order;
      });
      setCards(mapped);
    })();
  }, []);

  function scrollBy(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 320, behavior: "smooth" });
  }

  if (cards.length === 0) return null;

  return (
    <section className="bg-white py-10 md:py-16">
      <div className="container-real">
        <FadeUp className="mb-6 flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Our Locations</div>
            <h2 className="mt-3 text-3xl md:text-5xl">Where We Operate.</h2>
          </div>
          <div className="flex gap-2">
            <button onClick={() => scrollBy(-1)} aria-label="Scroll left" className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-border hover:bg-soft transition active:scale-95">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={() => scrollBy(1)} aria-label="Scroll right" className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-border hover:bg-soft transition active:scale-95">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </FadeUp>
        <div ref={scrollerRef} className="flex gap-5 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {cards.map((c) => (
            <CityCard key={c.id} card={c} onWaitlist={() => setModalCard(c)} />
          ))}
        </div>
      </div>
      {modalCard && <WaitlistModal card={modalCard} onClose={() => setModalCard(null)} />}
    </section>
  );
}

function CityCard({ card, onWaitlist }: { card: LocationCard; onWaitlist: () => void }) {
  const isLive = card.status === "live";
  const inner = (
    <div className="relative w-[220px] md:w-[260px] h-[300px] md:h-[340px] rounded-xl overflow-hidden shrink-0 snap-start group cursor-pointer">
      <div aria-hidden className="absolute inset-0 bg-neutral-800" />
      <img
        src={card.hero_image_url ?? ""}
        alt={`${card.city} city skyline`}
        loading="lazy"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${isLive ? "" : "grayscale-[40%] brightness-90"}`}
      />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <div className="absolute top-3 right-3">
        {isLive ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/95 text-white text-[10px] font-semibold px-2 py-1 backdrop-blur">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Live
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-white/95 text-foreground text-[10px] font-semibold px-2 py-1 backdrop-blur">
            Coming Soon
          </span>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4 text-center">
        <div className="text-white text-lg md:text-xl font-semibold drop-shadow">{card.city}</div>
        <div className="mx-auto mt-2 h-[3px] w-10 bg-real-red rounded-full" />
        <div className="mt-2 text-white/90 text-xs font-medium inline-flex items-center gap-1">
          {isLive ? <>Get A Quote <ArrowRight className="w-3 h-3" /></> : "Join Waitlist"}
        </div>
      </div>
    </div>
  );
  if (isLive) {
    return (
      <Link to="/$slug" params={{ slug: card.slug }} className="shrink-0">
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onWaitlist} className="shrink-0 text-left">
      {inner}
    </button>
  );
}

function WaitlistModal({ card, onClose }: { card: LocationCard; onClose: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [driverStatus, setDriverStatus] = useState<"active" | "pending" | "not_yet">("not_yet");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName || !email) return toast.error("Name and email required");
    setSubmitting(true);
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const { error } = await supabase.from("waitlist").insert({
      market_id: card.market_id,
      full_name: fullName,
      email,
      phone: phone || null,
      driver_status: driverStatus,
      source: "homepage_waitlist",
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_term: params.get("utm_term"),
      utm_content: params.get("utm_content"),
      gclid: params.get("gclid"),
    } as any);
    setSubmitting(false);
    if (error) return toast.error(error.message);
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "waitlist_signup", { city: card.city });
    }
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-md rounded-2xl bg-white p-6 md:p-8 shadow-2xl">
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 p-1 text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>
        {done ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-12 h-12 text-real-red mx-auto" />
            <h3 className="mt-4 text-2xl font-semibold">You're On The List</h3>
            <p className="mt-2 text-muted-foreground text-sm">We'll Tell You When {card.city} Opens.</p>
            <button onClick={onClose} className="mt-6 rounded-lg bg-real-red text-white px-6 py-2.5 text-sm font-medium hover:opacity-90 transition active:scale-95">
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Waitlist</div>
            <h3 className="mt-2 text-2xl md:text-3xl font-semibold">Join The Waitlist</h3>
            <p className="mt-2 text-sm text-muted-foreground">Be First To Know When We Launch In {card.city}.</p>
            <form onSubmit={submit} className="mt-5 space-y-3">
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Full Name" className="w-full rounded-lg bg-soft border border-transparent focus:border-real-red focus:bg-white px-4 py-3 text-sm outline-none transition" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" placeholder="Email" className="w-full rounded-lg bg-soft border border-transparent focus:border-real-red focus:bg-white px-4 py-3 text-sm outline-none transition" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Phone" className="w-full rounded-lg bg-soft border border-transparent focus:border-real-red focus:bg-white px-4 py-3 text-sm outline-none transition" />
              <div>
                <div className="text-xs font-medium mb-2">Already Driving On A Gig App?</div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { v: "active", l: "Yes" },
                    { v: "pending", l: "Pending" },
                    { v: "not_yet", l: "Not Yet" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setDriverStatus(opt.v)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        driverStatus === opt.v ? "border-real-red bg-real-red text-white" : "border-border bg-white hover:bg-soft"
                      }`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
              <button disabled={submitting} className="w-full rounded-lg bg-real-red text-white py-3 text-sm font-semibold hover:opacity-90 transition active:scale-95 disabled:opacity-50">
                {submitting ? "Submitting…" : "Notify Me"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}