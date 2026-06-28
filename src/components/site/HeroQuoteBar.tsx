import { ReactNode, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import heroBg from "@/assets/hero-bg.jpg";
import { FadeUp } from "./FadeUp";

type CityOpt = { slug: string; label: string };

export function HeroQuoteBar({
  headline,
  subhead,
  eyebrow,
  presetCitySlug,
  presetCityLabel,
}: {
  headline: string;
  subhead: ReactNode;
  eyebrow?: string;
  presetCitySlug?: string;
  presetCityLabel?: string;
}) {
  const [cities, setCities] = useState<CityOpt[]>(
    presetCitySlug && presetCityLabel ? [{ slug: presetCitySlug, label: presetCityLabel }] : [],
  );
  const [city, setCity] = useState(presetCitySlug ?? "");
  const [length, setLength] = useState("By The Week");
  const [gig, setGig] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("sites")
        .select("slug, title, status, markets(name, state)")
        .eq("is_published", true);
      const opts = ((data ?? []) as any[])
        .filter((r) => r.status === "live")
        .map((r) => {
          const name = r.markets?.name ?? r.title;
          const state = r.markets?.state;
          return { slug: r.slug as string, label: state ? `${name}, ${state}` : name };
        });
      // Ensure the preset city is present in the list even if it's not live yet
      if (presetCitySlug && !opts.find((o) => o.slug === presetCitySlug) && presetCityLabel) {
        opts.unshift({ slug: presetCitySlug, label: presetCityLabel });
      }
      setCities(opts);
    })();
  }, [presetCitySlug, presetCityLabel]);

  function submit() {
    const target = city || presetCitySlug;
    if (!target) return;
    if (presetCitySlug && target === presetCitySlug) {
      document.getElementById("quote-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const qs = new URLSearchParams();
    if (length) qs.set("len", length);
    if (gig) qs.set("gig", gig);
    const q = qs.toString();
    window.location.href = `/${target}${q ? `?${q}` : ""}#quote-form`;
  }

  return (
    <section className="relative isolate overflow-hidden px-6 md:px-12 pt-24 md:pt-32 pb-14 md:pb-20 text-center text-white">
      <div aria-hidden className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: `url(${heroBg})` }} />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/75 via-black/60 to-black/85" />
      <FadeUp>
        {eyebrow && (
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">{eyebrow}</div>
        )}
        <h1 className="mt-4 text-[40px] md:text-[72px] leading-[1.02] font-semibold text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]">
          {headline}
        </h1>
        <p className="mt-5 text-base md:text-xl text-white/85 max-w-3xl mx-auto leading-relaxed whitespace-pre-line">
          {subhead}
        </p>
      </FadeUp>

      <FadeUp delay={80}>
        <div className="mt-10 max-w-5xl mx-auto bg-white rounded-2xl shadow-2xl shadow-black/40 p-5 md:p-6 text-left text-foreground">
          <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1fr_auto] gap-3 md:gap-4 items-end">
            <SelectField
              label="City"
              value={city}
              onChange={setCity}
              placeholder="Select Your City"
              options={cities.map((c) => ({ value: c.slug, label: c.label }))}
            />
            <SelectField
              label="Rental Length"
              value={length}
              onChange={setLength}
              options={[
                { value: "By The Week", label: "By The Week" },
                { value: "By The Month", label: "By The Month" },
              ]}
            />
            <SelectField
              label="Active On A Gig App?"
              value={gig}
              onChange={setGig}
              placeholder="Select"
              options={[
                { value: "Yes", label: "Yes" },
                { value: "Pending", label: "Pending" },
                { value: "Not Yet", label: "Not Yet" },
              ]}
            />
            <button
              type="button"
              onClick={submit}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-real-red text-white px-6 text-sm font-semibold h-[46px] hover:opacity-90 transition active:scale-95"
            >
              Get My Quote <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <p className="mt-4 text-center text-xs md:text-sm text-muted-foreground">
            Quick quote — no deposit, no credit check. We'll confirm your car on a fast call.
          </p>
        </div>
      </FadeUp>
    </section>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">{label}</span>
      <div className="relative mt-1.5">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-lg border border-border bg-white px-4 py-3 pr-9 text-sm font-medium text-foreground focus:outline-none focus:border-real-red"
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground">
          <path fill="currentColor" d="M5.5 7.5L10 12l4.5-4.5z" />
        </svg>
      </div>
    </label>
  );
}