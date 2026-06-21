import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { FadeUp } from "./FadeUp";

type ComparisonRow = {
  feature: string;
  real: string;
  uberlyft: string;
  traditional: string;
  real_is_win: boolean;
};

type ComparisonData = {
  title: string;
  columns: string[];
  rows: ComparisonRow[];
  disclaimer: string;
  as_of_date: string;
};

const DEFAULT_DATA: ComparisonData = {
  title: "The Gig Driver's Breakdown.",
  columns: ["Real Automotive", "Uber Rent / Lyft Express", "Avis / Hertz / Enterprise"],
  rows: [
    { feature: "Multi-App Use", real: "Yes", uberlyft: "No", traditional: "No", real_is_win: true },
    { feature: "Mileage", real: "Unlimited (In Service Area)", uberlyft: "Restrictive / Per-Mile", traditional: "Restrictive / Per-Mile", real_is_win: true },
    { feature: "Gig-App Eligibility", real: "Any Gig Service", uberlyft: "Single Platform", traditional: "Not Gig-Focused", real_is_win: true },
    { feature: "Credit Check", real: "No", uberlyft: "No", traditional: "Often Yes", real_is_win: true },
    { feature: "Approval Speed", real: "As Soon As Same Day", uberlyft: "Varies", traditional: "Varies", real_is_win: true },
    { feature: "Deposit", real: "One Low Refundable", uberlyft: "~$200-250 Hold", traditional: "~$200-500 Hold", real_is_win: false },
    { feature: "Local Support", real: "Local Team", uberlyft: "Call Center", traditional: "Rental Counter", real_is_win: true },
  ],
  disclaimer:
    "Comparison reflects general program features; competitor terms vary by location and change over time. Figures are estimates.",
  as_of_date: "June 2026",
};

export function ComparisonSection({ siteId }: { siteId?: string }) {
  const [data, setData] = useState<ComparisonData>(DEFAULT_DATA);

  useEffect(() => {
    async function load() {
      let query = supabase.from("site_content").select("value").eq("key", "comparison");
      if (siteId) {
        query = query.eq("site_id", siteId);
      } else {
        query = query.is("site_id", null);
      }
      const { data: row } = await query.maybeSingle();
      if (row?.value) {
        const parsed = parseComparison(row.value);
        if (parsed) setData(parsed);
      }
    }
    load();
  }, [siteId]);

  const [colReal, colUber, colTrad] = data.columns;

  const cellToneClass = (text: string): string => {
    const t = text.toLowerCase().trim();
    if (t === "no" || t.startsWith("restrictive") || t.startsWith("not ") || t.startsWith("often")) return "text-red-500/80";
    if (t === "yes" || t === "included" || t.startsWith("unlimited")) return "text-green-600";
    return "text-muted-foreground";
  };

  return (
    <section className="bg-soft py-14 md:py-20">
      <div className="container-real">
        <FadeUp className="text-center mb-10">
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Why Drivers Choose Us</div>
          <h2 className="mt-3 text-3xl md:text-5xl">{data.title}</h2>
        </FadeUp>

        <FadeUp delay={60}>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <div className="min-w-[640px] rounded-2xl border border-border bg-white overflow-hidden shadow-sm">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-5 md:px-6 py-5 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground border-b border-border border-r bg-white w-[28%]">
                      Feature
                    </th>
                    <th className="px-5 md:px-6 py-5 text-center text-sm font-bold uppercase tracking-wider text-white bg-real-red border-b border-real-red border-r w-[24%]">
                      {colReal}
                    </th>
                    <th className="px-5 md:px-6 py-5 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground border-b border-border border-r bg-white w-[24%]">
                      {colUber}
                    </th>
                    <th className="px-5 md:px-6 py-5 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground border-b border-border bg-white w-[24%]">
                      {colTrad}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr
                      key={row.feature}
                      className={`group transition-colors ${
                        i % 2 === 1 ? "bg-soft/40" : "bg-white"
                      } hover:bg-muted/70`}
                    >
                      <td className="px-5 md:px-6 py-5 md:py-6 text-[15px] font-semibold text-foreground border-b border-border border-r">
                        {row.feature}
                      </td>
                      <td className="px-5 md:px-6 py-5 md:py-6 text-center text-[15px] border-b border-border border-r bg-yellow-100 font-semibold text-foreground">
                        {row.real}
                      </td>
                      <td className={`px-5 md:px-6 py-5 md:py-6 text-center text-[14px] border-b border-border border-r ${cellToneClass(row.uberlyft)}`}>
                        {row.uberlyft}
                      </td>
                      <td className={`px-5 md:px-6 py-5 md:py-6 text-center text-[14px] border-b border-border ${cellToneClass(row.traditional)}`}>
                        {row.traditional}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </FadeUp>

        <FadeUp delay={120}>
          <p className="mt-6 text-xs text-muted-foreground text-center whitespace-nowrap">
            {data.disclaimer} As of {data.as_of_date}.
          </p>
        </FadeUp>
      </div>
    </section>
  );
}

function parseComparison(value: Json): ComparisonData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.title === "string" &&
    Array.isArray(v.columns) &&
    Array.isArray(v.rows) &&
    typeof v.disclaimer === "string" &&
    typeof v.as_of_date === "string"
  ) {
    return v as unknown as ComparisonData;
  }
  return null;
}
