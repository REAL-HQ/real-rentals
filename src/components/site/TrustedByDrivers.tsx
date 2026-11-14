import { useEffect, useState } from "react";
import { Star, Quote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { FadeUp } from "./FadeUp";

type Testimonial = {
  name: string;
  city?: string;
  quote: string;
};

type TrustedData = {
  google_rating?: number | null;
  google_review_count?: number | null;
  google_url?: string | null;
  testimonials?: Testimonial[];
};

function parse(value: Json): TrustedData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const testimonials = Array.isArray(v.testimonials)
    ? (v.testimonials as unknown[]).flatMap((t) => {
        if (!t || typeof t !== "object") return [];
        const o = t as Record<string, unknown>;
        if (typeof o.name !== "string" || typeof o.quote !== "string") return [];
        return [{ name: o.name, quote: o.quote, city: typeof o.city === "string" ? o.city : undefined }];
      })
    : [];
  return {
    google_rating: typeof v.google_rating === "number" ? v.google_rating : null,
    google_review_count: typeof v.google_review_count === "number" ? v.google_review_count : null,
    google_url: typeof v.google_url === "string" ? v.google_url : null,
    testimonials,
  };
}

export function TrustedByDrivers({ siteId }: { siteId?: string }) {
  const [data, setData] = useState<TrustedData | null>(null);

  useEffect(() => {
    (async () => {
      let q = supabase.from("site_content").select("value").eq("key", "trusted");
      q = siteId ? q.eq("site_id", siteId) : q.is("site_id", null);
      const { data: row } = await q.maybeSingle();
      if (row?.value) setData(parse(row.value));
    })();
  }, [siteId]);

  const testimonials = data?.testimonials ?? [];
  const hasGoogle = !!data?.google_rating;
  if (!hasGoogle && testimonials.length === 0) return null;

  return (
    <section className="bg-white py-14 md:py-20">
      <div className="container-real">
        <FadeUp className="text-center max-w-2xl mx-auto">
          <div className="text-[11px] font-semibold tracking-[0.25em] text-real-red">Trusted By Drivers</div>
          <h2 className="mt-3 text-3xl md:text-5xl">Real Drivers. Real Reviews.</h2>
        </FadeUp>

        {hasGoogle && (
          <FadeUp className="mt-8 flex justify-center">
            <a
              href={data?.google_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 rounded-2xl border border-border bg-soft px-6 py-4 hover:border-real-red/40 transition"
            >
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`w-5 h-5 ${i < Math.round(data!.google_rating!) ? "fill-real-red text-real-red" : "text-muted-foreground/30"}`}
                    strokeWidth={1.5}
                  />
                ))}
              </div>
              <div className="text-left leading-tight">
                <div className="text-base font-semibold">{data!.google_rating!.toFixed(1)} On Google</div>
                {data?.google_review_count ? (
                  <div className="text-xs text-muted-foreground">{data.google_review_count} Verified Reviews</div>
                ) : null}
              </div>
            </a>
          </FadeUp>
        )}

        {testimonials.length > 0 && (
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t, i) => (
              <FadeUp key={`${t.name}-${i}`} delay={i * 60}>
                <figure className="h-full rounded-2xl border border-border bg-soft p-7 flex flex-col">
                  <Quote className="w-6 h-6 text-real-red" strokeWidth={1.75} />
                  <blockquote className="mt-4 text-base leading-relaxed text-foreground/90 flex-1">
                    "{t.quote}"
                  </blockquote>
                  <figcaption className="mt-5 text-sm">
                    <div className="font-semibold">{t.name}</div>
                    {t.city && <div className="text-muted-foreground">{t.city}</div>}
                  </figcaption>
                </figure>
              </FadeUp>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}