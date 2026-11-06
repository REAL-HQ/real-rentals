import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getTodaysOps } from "@/lib/todays-ops.functions";
import { TODAYS_OPS_ENABLED } from "@/lib/todays-ops-flag";
import type { TodaysOpsBoard } from "@/lib/todays-ops";

export function TodaysOps() {
  if (!TODAYS_OPS_ENABLED) return null;
  return <TodaysOpsLive />;
}

function TodaysOpsLive() {
  const load = useServerFn(getTodaysOps);
  const [board, setBoard] = useState<TodaysOpsBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    load({ data: {} })
      .then((next) => {
        if (live) setBoard(next);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Could not load Today's Ops");
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (error) {
    return <p className="text-[13px] text-[#D03020]">{error}</p>;
  }
  if (!board) {
    return <p className="text-[13px] text-[#55555E]">Loading Today's Ops</p>;
  }

  return (
    <div className="space-y-6" data-testid="todays-ops">
      <p className="text-[13px] text-[#55555E]">{board.heading} · Eastern Time</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {board.sections.map((section) => (
          <section key={section.id} className="rounded-xl border border-[#EDEDF0] bg-white p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-[#111114]">{section.title}</h2>
              <span className="text-[12px] text-[#9A9AA3]">{section.items.length}</span>
            </div>
            {section.truncated && <p className="mt-1 text-[12px] text-[#55555E]">Showing The First 100</p>}
            {section.items.length === 0 ? (
              <p className="mt-3 text-[13px] text-[#9A9AA3]">None</p>
            ) : (
              <ul className="mt-3 divide-y divide-[#EDEDF0]">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      to="/admin"
                      search={item.search}
                      className="flex items-start justify-between gap-3 py-2.5 text-[13px] hover:bg-[#FAFAFB]"
                    >
                      <span className="font-medium text-[#111114]">{item.label}</span>
                      <span className="shrink-0 text-[#55555E]">{item.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <section className="rounded-xl border border-[#EDEDF0] bg-white p-4">
        <h2 className="text-[15px] font-semibold text-[#111114]">Not Shown</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] text-[#55555E]">
          {board.omitted.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
