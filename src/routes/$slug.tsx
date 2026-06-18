import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
  CalendarClock,
  Car,
  ChevronDown,
  Check,
  Clock3,
  FileText,
  Infinity as InfinityIcon,
  MapPin,
  Shield,
  Sparkles,
  UserCheck,
  Wrench,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import heroBg from "@/assets/hero-bg.jpg";
import sedanImg from "@/assets/cars/accord.jpg.asset.json";
import suvImg from "@/assets/cars/crv.jpg.asset.json";
import xlImg from "@/assets/cars/odyssey.jpg.asset.json";

type Site = {
  id: string;
  slug: string;
  title: string;
  market_id: string | null;
  is_published: boolean;
};

type Market = { id: string; name: string; state: string | null; slug: string };
type ContentMap = Record<string, Json>;
type Benefit = { icon?: string; label: string; body?: string };
type Step = { n?: string | number; title: string; body: string };
type VehicleType = { name: string; tagline: string; image?: string };
type GigPlatforms = { items?: string[]; disclaimer?: string };

const iconMap = {
  check: Check,
  shield: Shield,
  wrench: Wrench,
  infinity: InfinityIcon,
  zap: Sparkles,
  clock: Clock3,
  calendar: CalendarClock,
  briefcase: Briefcase,
  badge: BadgeCheck,
  user: UserCheck,
  car: Car,
  file: FileText,
};

const defaultBenefits: Benefit[] = [
  { icon: "check", label: "No Credit Check" },
  { icon: "shield", label: "Insurance Options Available" },
  { icon: "wrench", label: "Maintenance Included" },
  { icon: "infinity", label: "High-Mileage Friendly" },
  { icon: "zap", label: "Same-Day Approval" },
];

const defaultHowItWorks: Step[] = [
  { n: "01", title: "Apply", body: "Share your contact details and rental timeline so we can start your quote." },
  { n: "02", title: "Same Day Approval", body: "Our team reviews your application quickly and confirms the best next steps." },
  { n: "03", title: "Pick Up", body: "We match you to the right vehicle type and schedule pickup once you are cleared." },
  { n: "04", title: "Start Earning", body: "Use the vehicle for rideshare and delivery platforms with weekly flexibility." },
];

const defaultVehicleTypes: VehicleType[] = [
  { name: "Sedans", tagline: "Efficient Daily Drivers For Rideshare And Delivery.", image: sedanImg.url },
  { name: "SUVs", tagline: "More Room For Drivers Who Need Flexible Cargo Space.", image: suvImg.url },
  { name: "XL Vehicles", tagline: "Larger Options For Airport Runs, Groups, And Higher-Capacity Trips.", image: xlImg.url },
];

const PLATFORM_STATUSES = ["Yes", "Pending", "Not Yet"] as const;
const WEEKLY_OPTIONS = ["1 Week", "2 Weeks", "3 Weeks", "4+ Weeks"];
const MONTHLY_OPTIONS = ["1 Month", "2 Months", "3+ Months"];
const DEFAULT_GIGS = ["Uber", "Lyft", "DoorDash", "Instacart", "Amazon Flex"];

type QuoteForm = {
  full_name: string;
  phone: string;
  email: string;
  platform_status: (typeof PLATFORM_STATUSES)[number] | "";
  rental_mode: "weekly" | "monthly";
  rental_length: string;
};

export const Route = createFileRoute("/$slug")({
  loader: async ({ params }) => {
    const { data: site } = await supabase
      .from("sites")
      .select("*")
      .eq("slug", params.slug)
      .eq("is_published", true)
      .maybeSingle();
    if (!site) throw notFound();

    const [{ data: contentRows }, marketResult] = await Promise.all([
      supabase.from("site_content").select("key, value").eq("site_id", site.id),
      site.market_id
        ? supabase.from("markets").select("id, name, state, slug").eq("id", site.market_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const content = ((contentRows ?? []) as { key: string; value: Json }[]).reduce<ContentMap>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    return { site: site as Site, market: (marketResult.data as Market) ?? null, content };
  },
  head: ({ loaderData }) => {
    const title = loaderData?.site.title ?? "City";
    const state = loaderData?.market?.state ? `, ${loaderData.market.state}` : "";
    const content = loaderData?.content ?? {};
    const seoTitle = asString(content.seo_title) ?? `Drive For Uber, Lyft & Delivery In ${title}${state} | REAL AUTOMOTIVE`;
    const seoDescription =
      asString(content.seo_description) ??
      `Get a rideshare or delivery rental quote in ${title}${state}. Unlimited miles, maintenance handled, insurance options, and fast approvals.`;
    return {
      meta: [
        { title: seoTitle },
        { name: "description", content: seoDescription },
        { property: "og:title", content: seoTitle },
        { property: "og:description", content: seoDescription },
      ],
    };
  },
  notFoundComponent: () => (
    <SiteLayout>
      <section className="container-real py-32 text-center">
        <h1 className="text-4xl md:text-5xl font-semibold">City Not Found</h1>
        <p className="mt-4 text-muted-foreground">We're not in this market yet.</p>
        <Link to="/" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-real-red px-6 py-3 text-sm font-medium text-white">
          Back Home <ArrowRight className="w-4 h-4" />
        </Link>
      </section>
    </SiteLayout>
  ),
  errorComponent: ({ error, reset }) => {
    const navigate = useNavigate();
    return (
      <SiteLayout>
        <section className="container-real py-32 text-center">
          <h1 className="text-3xl font-semibold">Something Went Wrong</h1>
          <p className="mt-3 text-muted-foreground">{error.message}</p>
          <button onClick={() => { reset(); navigate({ to: "/" }); }} className="mt-6 rounded-lg bg-real-red px-6 py-3 text-sm font-medium text-white">Back Home</button>
        </section>
      </SiteLayout>
    );
  },
  component: CityPage,
});

function CityPage() {
  const { site, market, content } = Route.useLoaderData();
  const cityLabel = market?.state ? `${site.title}, ${market.state}` : site.title;
  const ctaLabel = asString(content.cta_label) ?? "Get My Quote";
  const headline = interpolate(asString(content.hero_headline) ?? `Drive For Uber, Lyft & Delivery In ${site.title} This Week`, site, market);
  const subhead = interpolate(
    asString(content.hero_subhead) ??
      `Get matched with a rideshare-ready rental in ${cityLabel}. Unlimited miles, maintenance handled, insurance options, and flexible weekly terms.`,
    site,
    market,
  );
  const eyebrow = interpolate(asString(content.hero_eyebrow) ?? cityLabel, site, market);
  const benefits = arrayOfObjects<Benefit>(content.benefits, defaultBenefits);
  const gigConfig = objectOf<GigPlatforms>(content.gig_platforms, {});
  const gigItems = Array.isArray(gigConfig.items) && gigConfig.items.length > 0 ? gigConfig.items : DEFAULT_GIGS;
  const howItWorks = arrayOfObjects<Step>(content.how_it_works, defaultHowItWorks);
  const localIntro = interpolate(
    asString(content.local_intro) ??
      `${site.title} drivers need a fast, flexible rental path that works for rideshare, delivery, airport runs, and everyday gig work. REAL AUTOMOTIVE helps you get quoted, approved, and matched without showing live inventory or locking you into a single car online.`,
    site,
    market,
  );
  const vehicleTypes = arrayOfObjects<VehicleType>(content.vehicle_types, defaultVehicleTypes);

  const scrollToForm = () => document.getElementById("quote-form")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <SiteLayout>
      <section className="relative isolate overflow-hidden bg-black px-6 pt-24 pb-12 text-white md:px-12 md:pt-34 md:pb-16">
        <div aria-hidden className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: `url(${heroBg})` }} />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/75 via-black/60 to-black/85" />
        <div className="container-real grid items-center gap-10 lg:grid-cols-[1fr_440px]">
          <FadeUp>
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">
              <MapPin className="h-3.5 w-3.5" /> {eyebrow}
            </div>
            <h1 className="mt-5 max-w-4xl text-[42px] font-semibold leading-[1.05] text-white md:text-[70px]">
              {headline}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/80 md:text-xl">{subhead}</p>
            <button
              type="button"
              onClick={scrollToForm}
              className="mt-9 inline-flex items-center gap-2 rounded-lg bg-real-red px-8 py-4 text-sm font-semibold text-white transition hover:opacity-90 active:scale-95"
            >
              {ctaLabel} <ArrowRight className="h-4 w-4" />
            </button>
          </FadeUp>
          <FadeUp delay={80}>
            <div id="quote-form" className="scroll-mt-24">
              <QuoteFormCard site={site} market={market} compact />
            </div>
          </FadeUp>
        </div>
      </section>

      <section className="border-y border-border bg-white">
        <div className="container-real flex flex-wrap items-center justify-between gap-x-8 gap-y-4 py-5">
          {benefits.map((benefit) => {
            const Icon = iconMap[(benefit.icon ?? "check") as keyof typeof iconMap] ?? Check;
            return (
              <div key={benefit.label} className="flex items-center gap-2.5">
                <Icon className="h-5 w-5 text-real-red shrink-0" strokeWidth={2.25} />
                <span className="text-sm font-semibold text-foreground whitespace-nowrap">{benefit.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-soft py-8 md:py-10">
        <div className="container-real text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">Eligible To Drive For</div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 md:gap-4">
            <GigLogoMarquee items={gigItems} />
          </div>
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground whitespace-nowrap">
            {asString(gigConfig.disclaimer) ?? "REAL AUTOMOTIVE is not affiliated with Uber, Lyft, DoorDash, Instacart, or Amazon Flex. Platform eligibility may vary by location and platform rules."}
          </p>
        </div>
      </section>


      <section className="bg-soft py-14 md:py-20">
        <div className="container-real">
          <FadeUp className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">How It Works</div>
            <h2 className="mt-4 text-3xl md:text-5xl">From Quote To Keys.</h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground md:text-lg">{localIntro}</p>
          </FadeUp>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {howItWorks.map((step, index) => (
              <FadeUp key={step.title} delay={index * 60}>
                <div className="h-full border border-border bg-white p-6">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">{String(step.n ?? index + 1).padStart(2, "0")}</div>
                  <h3 className="mt-5 text-xl font-semibold">{step.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-14 md:py-20">
        <div className="container-real">
          <FadeUp className="text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">Vehicle Types</div>
            <h2 className="mt-4 text-3xl md:text-5xl">Matched For Your Work.</h2>
          </FadeUp>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {vehicleTypes.map((vehicle, index) => (
              <FadeUp key={vehicle.name} delay={index * 60}>
                <div className="overflow-hidden border border-border bg-white">
                  <div className="flex aspect-[4/3] items-center justify-center bg-soft">
                    {vehicle.image ? (
                      <img src={vehicle.image} alt={`${vehicle.name} representative rental type`} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <Car className="h-16 w-16 text-real-red" strokeWidth={1.8} />
                    )}
                  </div>
                  <div className="p-6 text-center">
                    <h3 className="text-2xl font-semibold">{vehicle.name}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{vehicle.tagline}</p>
                  </div>
                </div>
              </FadeUp>
            ))}
          </div>
          <p className="mt-7 text-center text-sm font-medium text-muted-foreground">Your Exact Car Is Matched On Your Call.</p>
        </div>
      </section>

      <section className="bg-black py-16 text-center text-white md:py-20">
        <div className="container-real">
          <FadeUp>
            <h2 className="text-3xl md:text-5xl">Ready To Drive In {site.title}?</h2>
            <p className="mx-auto mt-4 max-w-2xl text-white/70">Start with Step 1 and we’ll save your quote before you finish the full profile.</p>
            <button
              type="button"
              onClick={scrollToForm}
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-real-red px-8 py-4 text-sm font-semibold text-white transition hover:opacity-90 active:scale-95"
            >
              {ctaLabel} <ArrowRight className="h-4 w-4" />
            </button>
          </FadeUp>
        </div>
      </section>
    </SiteLayout>
  );
}

function QuoteFormCard({ site, market, compact = false }: { site: Site; market: Market | null; compact?: boolean }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<QuoteForm>({
    full_name: "",
    phone: "",
    email: "",
    platform_status: "",
    rental_mode: "weekly",
    rental_length: "1 Week",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);

  const utms = useMemo(() => {
    if (typeof window === "undefined") return {};
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_term: params.get("utm_term"),
      utm_content: params.get("utm_content"),
      gclid: params.get("gclid"),
    };
  }, []);

  const update = <K extends keyof QuoteForm>(key: K, value: QuoteForm[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "rental_mode") next.rental_length = value === "weekly" ? "1 Week" : "1 Month";
      return next;
    });
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!z.string().min(2).safeParse(form.full_name).success) next.full_name = "Required";
    if (!z.string().email().safeParse(form.email).success) next.email = "Invalid Email";
    if (!/^\d{7,}$/.test(form.phone.replace(/\D/g, ""))) next.phone = "Invalid Phone";
    if (!form.platform_status) next.platform_status = "Required";
    if (!form.rental_length) next.rental_length = "Required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  async function submit() {
    if (!validate()) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setSubmitting(true);
    const payload = {
      full_name: form.full_name,
      phone: form.phone,
      email: form.email,
      platform_status: form.platform_status,
      rental_length: form.rental_length,
      rental_term: form.rental_mode,
      market_id: site.market_id,
      city: market?.name ?? site.title,
      state: market?.state ?? null,
      source: "city_lp",
      status: "pending",
      ...utms,
    };
    const { data, error } = await supabase.from("applications").insert(payload as any).select("id").single();
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("lead", { detail: { city: site.slug, applicationId: data.id } }));
    }
    navigate({ to: "/apply/step2", search: { id: data.id } });
  }

  return (
    <div className={`border border-border bg-white text-foreground shadow-2xl shadow-black/20 ${compact ? "p-5 md:p-6" : "p-6 md:p-8"}`}>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-real-red">Step 1 Of 2</div>
        <h2 className="mt-2 text-2xl font-semibold">Get My Quote</h2>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4">
        <Field label="Full Name" value={form.full_name} error={errors.full_name} onChange={(value) => update("full_name", value)} />
        <Field label="Phone" value={form.phone} error={errors.phone} onChange={(value) => update("phone", value)} />
        <Field label="Email" type="email" value={form.email} error={errors.email} onChange={(value) => update("email", value)} />

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Are You Already Active On A Gig App?</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORM_STATUSES.map((status) => {
              const active = form.platform_status === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => update("platform_status", status)}
                  className={`rounded-lg border px-5 py-2 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}
                >
                  {status}
                </button>
              );
            })}
          </div>
          {errors.platform_status && <div className="mt-2 text-sm text-real-red">{errors.platform_status}</div>}
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">How Long Do You Want To Rent?</label>
          <div className="mt-2 inline-flex rounded-lg border border-border bg-white p-1">
            {(["weekly", "monthly"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => update("rental_mode", mode)}
                className={`rounded-md px-4 py-1.5 text-sm capitalize transition ${form.rental_mode === mode ? "bg-real-red text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                {mode === "weekly" ? "By The Week" : "By The Month"}
              </button>
            ))}
          </div>
          <div className="relative mt-3">
            <button
              type="button"
              onClick={() => setDurationOpen((open) => !open)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-white px-3 py-2 text-left text-sm text-foreground"
            >
              <span>{form.rental_length}</span>
              <ChevronDown className="mr-2 h-4 w-4 text-muted-foreground" />
            </button>
            {durationOpen && (
              <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-30 overflow-hidden rounded-lg border border-border bg-white py-1 text-sm text-foreground shadow-xl">
                {(form.rental_mode === "weekly" ? WEEKLY_OPTIONS : MONTHLY_OPTIONS).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => { update("rental_length", option); setDurationOpen(false); }}
                    className={`block w-full px-3 py-2 text-left hover:bg-soft ${form.rental_length === option ? "font-semibold text-real-red" : "text-foreground"}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>
          {errors.rental_length && <div className="mt-2 text-sm text-real-red">{errors.rental_length}</div>}
        </div>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="mt-7 inline-flex w-full items-center justify-center rounded-lg bg-real-red px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}

function Field({ label, value, error, onChange, type = "text" }: { label: string; value: string; error?: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm ${error ? "border-real-red" : "border-border"}`}
      />
      {error && <div className="mt-1 text-xs text-real-red">{error}</div>}
    </label>
  );
}

const gigLogoMap: Record<string, string> = {
  Uber: "https://cdn.simpleicons.org/uber/000000",
  Lyft: "https://cdn.simpleicons.org/lyft/FF00BF",
  DoorDash: "https://cdn.simpleicons.org/doordash/FF3008",
  Instacart: "https://cdn.simpleicons.org/instacart/FF8200",
  "Amazon Flex": "https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg",
};

function GigLogoMarquee({ items }: { items: string[] }) {
  const doubled = [...items, ...items];
  return (
    <div className="mt-5 overflow-hidden">
      <div className="flex w-max animate-marquee">
        {doubled.map((item, i) => {
          const logoUrl = gigLogoMap[item];
          return (
            <div key={`${item}-${i}`} className="flex items-center justify-center px-6 md:px-10">
              {logoUrl ? (
                <img src={logoUrl} alt={item} className="h-10 md:h-14 w-auto max-w-[120px] md:max-w-[160px] opacity-80 hover:opacity-100 transition" loading="lazy" />
              ) : (
                <span className="text-xl md:text-2xl font-semibold text-foreground">{item}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function objectOf<T extends object>(value: Json | undefined, fallback: T): T {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : fallback;
}

function arrayOfObjects<T extends object>(value: Json | undefined, fallback: T[]): T[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && !Array.isArray(item)) ? (value as T[]) : fallback;
}

function interpolate(value: string, site: Site, market: Market | null) {
  return value
    .replaceAll("{City}", site.title)
    .replaceAll("{city}", site.title)
    .replaceAll("{State}", market?.state ?? "")
    .replaceAll("{state}", market?.state ?? "");
}