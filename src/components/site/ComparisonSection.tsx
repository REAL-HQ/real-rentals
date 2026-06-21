import { useEffect, useState } from "react";
import { Check } from "lucide-react";
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
  title: "How We Compare",
  columns: ["Real Automotive", "Uber/Lyft Programs", "Traditional Rentals"],
  rows: [
    { feature: "Multi-App Use", real: "Yes", uberlyft: "No", traditional: "No", real_is_win: true },
    { feature: "Mileage", real: "Unlimited (In Area)", uberlyft: "Restrictive/Per-Mile", traditional: "Restrictive/Per-Mile", real_is_win: true },
    { feature: "Gig-App Eligibility", real: "Uber, Lyft, DoorDash, Flex", uberlyft: "Single Platform", traditional: "Not Gig-Focused", real_is_win: true },
    { feature: "Credit Check", real: "No", uberlyft: "No", traditional: "Often Yes", real_is_win: true },
    { feature: "Approval Speed", real: "As Soon As Same Day", uberlyft: "Varies", traditional: "Varies", real_is_win: true },
    { feature: "Maintenance", real: "Included (Routine)", uberlyft: "Included", traditional: "Not Gig-Focused", real_is_win: false },
    { feature: "Deposit", real: "One Low Refundable", uberlyft: "~$200-250 Hold", traditional: "~$200-500 Hold", real_is_win: true },
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

  return (
    <section className="bg-soft py-14 md:py-20">
      <div className="container-real">
        <FadeUp className="text-center mb-10">
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Comparison</div>
          <h2 className="mt-3 text-3xl md:text-5xl">{data.title}</h2>
        </FadeUp>

        <FadeUp delay={60}>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <div className="min-w-[640px] rounded-2xl border border-border bg-white overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left p-4 md:p-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border border-r bg-white w-[28%]">
                      Feature
                    </th>
                    <th className="p-4 md:p-5 text-center text-sm font-semibold text-white bg-real-red border-b border-real-red border-r w-[24%]">
                      {colReal}
                    </th>
                    <th className="p-4 md:p-5 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border border-r bg-white w-[24%]">
                      {colUber}
                    </th>
                    <th className="p-4 md:p-5 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border bg-white w-[24%]">
                      {colTrad}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={row.feature} className={`group transition-colors ${i % 2 === 1 ? "bg-soft/50 hover:bg-muted/60" : "bg-white hover:bg-muted/40"}`}>
                      <td className="p-4 md:p-5 text-sm font-medium text-foreground border-b border-border border-r">
                        {row.feature}
                      </td>
                      <td
                        className={`p-4 md:p-5 text-center text-sm border-b border-border border-r transition-colors ${
                          row.real_is_win ? "bg-real-red/[0.04] group-hover:bg-real-red/[0.06]" : ""
                        }`}
                      >
                        <span className="inline-flex items-center justify-center gap-1.5">
                          {row.real_is_win && (
                            <Check className="w-4 h-4 text-green-600 shrink-0" strokeWidth={2.5} />
                          )}
                          <span className="font-medium text-foreground">{row.real}</span>
                        </span>
                      </td>
                      <td className="p-4 md:p-5 text-center text-sm text-muted-foreground border-b border-border border-r">
                        {row.uberlyft}
                      </td>
                      <td className="p-4 md:p-5 text-center text-sm text-muted-foreground border-b border-border">
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
          <p className="mt-6 text-xs text-muted-foreground text-center max-w-3xl mx-auto leading-relaxed">
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
