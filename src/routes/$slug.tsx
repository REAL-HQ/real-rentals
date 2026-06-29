import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Car,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  FileText,
  IdCard,
  KeyRound,
  MapPin,
  Phone,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCheck,
  Zap,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import { ComparisonSection } from "@/components/site/ComparisonSection";
import { TrustedByDrivers } from "@/components/site/TrustedByDrivers";
import { StickyCallBar } from "@/components/site/StickyCallBar";
import { CityHeroLeadForm } from "@/components/site/CityHeroLeadForm";
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
type Step = { n?: string | number; title: string; body: string };
type VehicleType = { name: string; tagline: string; image?: string };
type GigPlatforms = { items?: string[]; disclaimer?: string };

const defaultHowItWorks: Step[] = [
  { n: "01", title: "Book Your Car", body: "Share your contact details and rental timeline so we can start your quote." },
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
const DEFAULT_GIGS = ["Uber", "Lyft", "DoorDash", "Instacart", "Amazon Flex", "UberEats", "Grubhub"];


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
    const seoTitle = asString(content.seo_title) ?? `Drive For Uber, Lyft & Delivery In ${title}${state} | REAL RENTALS`;
    const seoDescription =
      asString(content.seo_description) ??
      `Get a rideshare or delivery rental quote in ${title}${state}. Unlimited miles, maintenance handled, insurance included, and fast approvals.`;
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
  const headline = interpolate(asString(content.hero_headline) ?? `Drive For Uber, Lyft & Delivery Service Apps In ${site.title} This Week`, site, market);
  const subhead = interpolate(
    asString(content.hero_subhead) ??
      "Rent a vehicle for Uber, Lyft, DoorDash and delivery work.\nInsurance included. Maintenance included. Fast approval. Drive this week.",
    site,
    market,
  );
  const eyebrow = interpolate(asString(content.hero_eyebrow) ?? cityLabel, site, market);
  
  const gigConfig = objectOf<GigPlatforms>(content.gig_platforms, {});
  const gigItems = Array.isArray(gigConfig.items) && gigConfig.items.length > 0 ? gigConfig.items : DEFAULT_GIGS;
  const howItWorks = arrayOfObjects<Step>(content.how_it_works, defaultHowItWorks);
  const localIntro = interpolate(
    asString(content.local_intro) ??
      `${site.title} drivers need a fast, flexible rental path that works for rideshare, delivery, airport runs, and everyday gig work. REAL RENTALS helps you get quoted, approved, and matched without showing live inventory or locking you into a single car online.`,
    site,
    market,
  );
  const vehicleTypes = arrayOfObjects<VehicleType>(content.vehicle_types, defaultVehicleTypes);

  const scrollToForm = () => document.getElementById("quote-form")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <SiteLayout>
      <CityHeroLeadForm
        id="quote-form"
        eyebrow={eyebrow}
        headline={headline}
        subhead={subhead}
        site={site}
        market={market}
        ctaLabel={ctaLabel}
      />

      <section className="bg-white py-8 md:py-10">
        <div className="container-real text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">Eligible To Drive For</div>
        </div>
        <GigLogoMarquee items={gigItems} />
        <div className="container-real text-center">
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground whitespace-nowrap">
            {asString(gigConfig.disclaimer) ?? "REAL RENTALS is not affiliated with Uber, Lyft, DoorDash, Instacart, or Amazon Flex. Platform eligibility may vary by location and platform rules."}
          </p>
        </div>
      </section>


      <section className="container-real py-14 md:py-24">
        <FadeUp className="text-center mb-14 max-w-5xl mx-auto">
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">How It Works</div>
          <h2 className="mt-3 text-3xl md:text-5xl">From Quote To Keys.</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">{localIntro}</p>
        </FadeUp>
        <div className="relative">
          <div aria-hidden className="hidden md:block absolute top-8 left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-real-red/30 to-transparent" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-8 relative">
            {howItWorks.map((step, index) => {
              const Icon = [FileText, ClipboardCheck, KeyRound, Zap][index % 4];
              const n = String(step.n ?? index + 1).padStart(2, "0");
              return (
                <FadeUp key={step.title} delay={index * 80}>
                  <div className="group relative rounded-2xl bg-white p-7 h-full border border-border hover:border-real-red/40 hover:shadow-lg transition-all duration-300">
                    <div className="flex items-center justify-between">
                      <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-real-red/10 text-real-red transition-colors">
                        <Icon className="w-7 h-7" strokeWidth={1.75} />
                      </div>
                      <div className="text-5xl font-bold text-foreground/5 group-hover:text-real-red/20 transition-colors leading-none">{n}</div>
                    </div>
                    <div className="mt-6 text-real-red text-[11px] font-semibold tracking-[0.2em]">STEP {n}</div>
                    <div className="mt-2 text-xl font-semibold">{step.title}</div>
                    <div className="mt-2 text-muted-foreground text-sm leading-relaxed">{step.body}</div>
                  </div>
                </FadeUp>
              );
            })}
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
          
        </div>
      </section>

      <ComparisonSection siteId={site.id} />

      <TrustedByDrivers siteId={site.id} />

      <WhatYouNeedSection />

      <ServiceAreaSection cityLabel={cityLabel} city={site.title} />

      <CityFAQSection cityLabel={cityLabel} content={content} />

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
      <div className="h-20 sm:hidden" aria-hidden />
      <StickyCallBar onApplyClick={scrollToForm} />
    </SiteLayout>
  );
}

const gigLogoMap: Record<string, string> = {
  Uber: "https://upload.wikimedia.org/wikipedia/commons/5/58/Uber_logo_2018.svg",
  Lyft: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Lyft_logo.svg",
  DoorDash: "https://upload.wikimedia.org/wikipedia/commons/6/6a/DoorDash_Logo.svg",
  Instacart: "https://upload.wikimedia.org/wikipedia/commons/9/9f/Instacart_logo_and_wordmark.svg",
  "Amazon Flex": "https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg",
  UberEats: "https://upload.wikimedia.org/wikipedia/commons/b/b3/Uber_Eats_2020_logo.svg",
  Grubhub: "https://upload.wikimedia.org/wikipedia/commons/3/3d/GrubHub_Logo_2016.svg",
};

function GigLogoMarquee({ items }: { items: string[] }) {
  // Quadruple for a seamless, continuous loop regardless of viewport width
  const repeated = [...items, ...items, ...items, ...items];
  return (
    <div className="mt-5 overflow-hidden">
      <div className="flex w-max animate-marquee">
        {repeated.map((item, i) => {
          const logoUrl = gigLogoMap[item];
          return (
            <div key={`${item}-${i}`} className="flex shrink-0 items-center justify-center px-5 md:px-8">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={item}
                  className="h-7 md:h-10 w-auto object-contain opacity-80 hover:opacity-100 transition"
                  loading="lazy"
                />
              ) : (
                <span className="text-base md:text-xl font-semibold text-foreground">{item}</span>
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

function WhatYouNeedSection() {
  const items = [
    { Icon: IdCard, title: "Valid Driver's License", body: "Active U.S. driver's license, 21 or older. Out-of-state licenses welcome." },
    { Icon: CreditCard, title: "No Deposit", body: "$0 security deposit. A payment card on file covers tolls, citations, damage, cleaning, and unpaid rent per your rental agreement." },
    { Icon: Smartphone, title: "Smartphone & Gig Account", body: "Active or pending account with Uber, Lyft, DoorDash, Instacart, or similar." },
    { Icon: ShieldCheck, title: "Clean Recent Record", body: "Reasonable driving history. No major violations in the last 3 years." },
  ];
  return (
    <section className="bg-white py-14 md:py-20">
      <div className="px-6 md:px-12 lg:px-20 xl:px-28">
        <FadeUp className="text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">What You'll Need To Apply</div>
          <h2 className="mt-3 text-3xl md:text-5xl">Quick Checklist Before You Apply.</h2>
          <p className="mt-4 text-muted-foreground">Have these ready and most drivers are approved the same day.</p>
        </FadeUp>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
          {items.map(({ Icon, title, body }, i) => (
            <FadeUp key={title} delay={i * 60}>
              <div className="h-full rounded-2xl border border-border bg-soft p-4 sm:p-5">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="inline-flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg sm:rounded-xl bg-real-red/10 text-real-red">
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={1.75} />
                  </div>
                  <div className="text-sm sm:text-base font-semibold whitespace-nowrap">{title}</div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

function ServiceAreaSection({ cityLabel, city }: { cityLabel: string; city: string }) {
  return (
    <section className="bg-soft py-14 md:py-16 border-y border-border">
      <div className="container-real grid items-center gap-8 md:grid-cols-[auto_1fr_auto]">
        <FadeUp>
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-real-red text-white">
            <MapPin className="h-7 w-7" strokeWidth={1.75} />
          </div>
        </FadeUp>
        <FadeUp>
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">Service Area</div>
          <h2 className="mt-2 text-2xl md:text-3xl font-semibold">Serving {cityLabel} And Surrounding Cities.</h2>
          <p className="mt-3 text-muted-foreground max-w-2xl leading-relaxed">
            Pickup and support based in Tampa. We rent to gig drivers across the wider metro area.<br />
            Call us to confirm coverage in your neighborhood.
          </p>
        </FadeUp>
        <FadeUp>
          <a
            href="tel:+18135550100"
            className="inline-flex items-center gap-2 rounded-lg border border-real-red bg-white px-5 py-3 text-sm font-semibold text-real-red transition hover:bg-real-red hover:text-white"
          >
            <Phone className="h-4 w-4" strokeWidth={2.25} /> (813) 555-0100
          </a>
        </FadeUp>
      </div>
    </section>
  );
}

type FaqItem = { q: string; a: string };

function CityFAQSection({ cityLabel, content }: { cityLabel: string; content: ContentMap }) {
  const defaults: FaqItem[] = [
    { q: "Do I need good credit to qualify?", a: "No. We don't run a credit check. Approval is based on your driving record and gig-platform eligibility." },
    { q: "How fast can I be on the road?", a: "Most drivers are approved the same day and picking up a vehicle within 24 to 48 hours." },
    { q: "Is insurance included?", a: "Insurance is included with every rental. Our team will walk you through what's included before you sign." },
    { q: "Are miles unlimited?", a: "Yes. Drive as many miles as you need — there are no per-mile fees." },
    { q: "What if the car needs maintenance?", a: "Routine maintenance is included. If something comes up, we handle it so you can keep earning." },
    { q: "Who pays for tolls and tickets?", a: "You do. Any tolls, tickets, or citations during your rental are your responsibility. Unpaid items are transferred to the driver on record per your rental agreement, and an admin fee may apply per notice." },
    { q: `Do you operate in ${cityLabel}?`, a: `Yes. We support gig drivers throughout the ${cityLabel} metro area. Call us to confirm pickup near you.` },
  ];
  const items = arrayOfObjects<FaqItem>(content.faq, defaults);
  return (
    <section className="bg-white py-14 md:py-20">
      <div className="container-real max-w-3xl">
        <FadeUp className="text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-real-red">Common Questions</div>
          <h2 className="mt-3 text-3xl md:text-5xl">Common Questions From {cityLabel} Drivers.</h2>
        </FadeUp>
        <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-white">
          {items.map((item, i) => (
            <FaqRow key={`${item.q}-${i}`} item={item} defaultOpen={i === 0} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqRow({ item, defaultOpen = false }: { item: FaqItem; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-soft"
        aria-expanded={open}
      >
        <span className="text-base font-semibold text-foreground">{item.q}</span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-real-red transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{item.a}</div>
      )}
    </div>
  );
}