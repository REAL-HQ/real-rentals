import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { fmtDate } from "@/lib/date-format";
import { displayPersonName } from "@/lib/display-normalize";
import { getOverviewToday } from "@/lib/overview-today.functions";
import {
  OVERVIEW_TODAY_ENABLED,
  recordedAmount,
  type OverviewTodayResult,
  type OverviewTodaySection,
} from "@/lib/overview-today";

function showDetail(detail: string): string {
  const withDate = detail.replace(/\d{4}-\d{2}-\d{2}/g, (iso) => fmtDate(iso) || iso).replaceAll("_", " ");
  return withDate.replace(/· (-?\d+(?:\.\d+)?) ·/, (_all, raw: string) => {
    const amount = recordedAmount(raw);
    return `· ${amount === null ? "Amount Unavailable" : `$${amount.toLocaleString("en-US")}`} ·`;
  });
}

function Section({ title, section }: { title: string; section: OverviewTodaySection }) {
  return (
    <section className="rounded-2xl border border-[#EDEDF0] bg-white p-4">
      <h3 className="text-[13px] font-semibold text-[#111114]">
        {title}
        <span className="ml-2 text-[12px] font-medium text-[#9A9AA3]">{section.total}</span>
      </h3>
      {section.rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-[#55555E]">None</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {section.rows.map((row) => (
            <li key={row.id} className="text-[13px] text-[#111114]">
              {row.href ? (
                <Link to="/admin" search={{ tab: "drivers", id: row.id }} className="font-medium hover:text-[#D03020]">
                  {displayPersonName(row.title)}
                </Link>
              ) : (
                <span className="font-medium">{row.title === "Unnamed" ? row.title : displayPersonName(row.title)}</span>
              )}
              <span className="mt-0.5 block text-[12px] text-[#55555E]">{showDetail(row.detail)}</span>
            </li>
          ))}
        </ul>
      )}
      {section.truncated && (
        <p className="mt-2 text-[12px] text-[#55555E]">Showing {section.rows.length}. More are not listed.</p>
      )}
    </section>
  );
}

/**
 * Renders nothing while Overview Today is off, and does not ask the server for rows.
 */
export default function OverviewToday() {
  const load = useServerFn(getOverviewToday);
  const [result, setResult] = useState<OverviewTodayResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!OVERVIEW_TODAY_ENABLED) return;
    let live = true;
    load({ data: undefined })
      .then((next) => {
        if (live) setResult(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (!OVERVIEW_TODAY_ENABLED) return null;
  if (failed || (result && !result.enabled)) {
    return (
      <section aria-label="Today" className="rounded-2xl border border-[#EDEDF0] bg-white p-4">
        <h2 className="text-[15px] font-semibold text-[#111114]">Today</h2>
        <p className="mt-1 text-[13px] text-[#CC0000]">Today Could Not Be Loaded</p>
      </section>
    );
  }
  if (!result) {
    return (
      <section aria-label="Today" className="rounded-2xl border border-[#EDEDF0] bg-white p-4">
        <h2 className="text-[15px] font-semibold text-[#111114]">Today</h2>
        <p className="mt-1 text-[13px] text-[#55555E]">Loading Today</p>
      </section>
    );
  }

  const day = fmtDate(result.today);
  return (
    <section aria-label="Today" className="space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold text-[#111114]">Today</h2>
        <p className="text-[12px] text-[#55555E]">{day}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Section title="Pickups" section={result.pickups} />
        <Section title="Returns" section={result.returns} />
        <Section title="Overdue Payments" section={result.overduePayments} />
        <Section title="New Leads" section={result.newLeads} />
      </div>
    </section>
  );
}
