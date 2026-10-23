import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getOverviewToday } from "@/lib/overview-today.functions";
import type { TodaySection } from "@/lib/overview-today";
import { SectionCard } from "./ui";

type Loaded =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; sections: TodaySection[] };

export function OverviewTodayCard() {
  const load = useServerFn(getOverviewToday);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    let live = true;
    load({ data: undefined })
      .then((result) => {
        if (!live) return;
        if (!result.ok) {
          setLoaded({ state: "error" });
          return;
        }
        setLoaded({ state: "ready", sections: result.sections });
      })
      .catch(() => {
        if (live) setLoaded({ state: "error" });
      });
    return () => {
      live = false;
    };
  }, [load]);

  const sections = loaded.state === "ready" ? loaded.sections.filter((section) => section.count > 0) : [];

  return (
    <SectionCard title="Today" subtitle="Eastern Time">
      {loaded.state === "loading" && <p className="text-sm text-[#55555E]">Loading Today</p>}
      {loaded.state === "error" && <p className="text-sm text-[#CC0000]">Could Not Load Today</p>}
      {loaded.state === "ready" && sections.length === 0 && <p className="text-sm text-[#55555E]">Nothing Due Today</p>}
      {sections.map((section) => (
        <div key={section.kind} className="mt-3 first:mt-0">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-[#111114]">{section.title}</h2>
            <span className="text-[12px] text-[#55555E]">{section.count}</span>
          </div>
          <ul className="mt-1">
            {section.items.map((item) => (
              <li key={item.id}>
                <Link
                  to="/admin"
                  search={item.link.id ? { tab: item.link.tab, id: item.link.id } : { tab: item.link.tab }}
                  className="flex items-baseline justify-between gap-3 py-1 text-[13px] text-[#111114] hover:text-[#D03020]"
                >
                  <span className="truncate">{item.title}</span>
                  {item.detail && <span className="shrink-0 text-[12px] text-[#55555E]">{item.detail}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </SectionCard>
  );
}
