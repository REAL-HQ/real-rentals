import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { PhoneOff } from "lucide-react";
import { listDnc } from "@/lib/dnc.functions";
import { DNC_LIST_TITLE, REMOVE_FROM_DNC_LABEL, dncMatchesSearch, type DncEntry } from "@/lib/dnc";
import { fmtDate } from "@/lib/date-format";
import { displayPersonName } from "@/lib/display-normalize";
import { AdminTableScroll } from "./AdminTableScroll";
import { AdminToolbar, TOOLBAR } from "./AdminToolbar";
import { EmptyState } from "./ui";
import { DncBadge, DNC_CHANGED_EVENT } from "./DncGuard";
import { DncActionDialog } from "./DncControls";

type View = "active" | "removed";

/**
 * Back office → DNC. Everyone on the internal Do Not Contact list: name, type,
 * reason, who added them and when, with search. Manager / Owner can remove an
 * entry (reason + confirmation); removed entries stay visible under Removed.
 */
export function DncPanel({ canRemove }: { canRemove: boolean }) {
  const load = useServerFn(listDnc);
  const [entries, setEntries] = useState<DncEntry[] | null>(null);
  const [installed, setInstalled] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("active");
  const [removing, setRemoving] = useState<DncEntry | null>(null);

  const refresh = useCallback(() => {
    load()
      .then((r) => {
        setInstalled(r.installed);
        setEntries(r.entries);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [load]);

  useEffect(() => {
    refresh();
    window.addEventListener(DNC_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(DNC_CHANGED_EVENT, refresh);
  }, [refresh]);

  const active = useMemo(() => (entries ?? []).filter((e) => !e.removedAt), [entries]);
  const removed = useMemo(() => (entries ?? []).filter((e) => e.removedAt), [entries]);
  const shown = useMemo(
    () => (view === "active" ? active : removed).filter((e) => dncMatchesSearch(e, q)),
    [view, active, removed, q],
  );

  return (
    <div data-testid="dnc-panel" className="min-w-0">
      <AdminToolbar
        compact
        search={
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Name, Reason Or Staff"
            aria-label="Search DNC List"
            className={TOOLBAR.search}
            data-testid="dnc-search"
          />
        }
        filters={
          <div className={TOOLBAR.segmented} role="tablist" aria-label="DNC View">
            {(["active", "removed"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`${TOOLBAR.segment} ${view === v ? "bg-[#F4F4F6] font-semibold text-[#111114]" : "text-[#55555E]"}`}
              >
                {v === "active" ? `On List (${active.length})` : `Removed (${removed.length})`}
              </button>
            ))}
          </div>
        }
      />
      {!installed ? (
        <EmptyState
          icon={<PhoneOff className="h-5 w-5" />}
          title="DNC List Not Enabled Yet"
          hint="The internal_dnc_list migration has not been applied to this database."
        />
      ) : failed ? (
        <EmptyState title="Could Not Load The DNC List" hint="Refresh the page to try again." />
      ) : (
        <AdminTableScroll className="rounded-lg border border-border bg-white">
          <table className="w-full text-sm" aria-label={DNC_LIST_TITLE}>
            <thead className="bg-soft text-[11px] tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Name</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Type</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Reason</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">
                  Added By
                </th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Added</th>
                {view === "removed" ? (
                  <th className="text-left font-medium px-4 py-2.5 border-b border-border">
                    Removed
                  </th>
                ) : null}
                <th className="px-2 py-2.5 border-b border-border w-10"></th>
              </tr>
            </thead>
            <tbody>
              {entries == null ? (
                <tr>
                  <td colSpan={7} className="p-4 text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4">
                    <EmptyState
                      title={
                        q
                          ? "No Matches"
                          : view === "active"
                            ? "No One On The DNC List"
                            : "No Removed Entries"
                      }
                      hint={
                        view === "active" && !q
                          ? "Use Move To DNC on a driver or waitlist profile."
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                shown.map((e) => {
                  const name = e.fullName ? displayPersonName(e.fullName) : "Unnamed";
                  return (
                    <tr
                      key={e.id}
                      data-testid="dnc-row"
                      className="border-b border-border last:border-0 align-top"
                    >
                      <td className="px-4 py-2.5 font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {e.applicationId ? (
                            <Link
                              to="/admin"
                              search={{ tab: "drivers", id: e.applicationId } as any}
                              className="hover:underline"
                            >
                              {name}
                            </Link>
                          ) : (
                            <span>{name}</span>
                          )}
                          {!e.removedAt ? <DncBadge entry={e} /> : null}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{e.personTypeLabel}</td>
                      <td className="px-4 py-2.5 min-w-[12rem] max-w-md whitespace-pre-wrap break-words">
                        {e.reason}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{e.addedBy}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {e.createdAt ? fmtDate(e.createdAt) : "—"}
                      </td>
                      {view === "removed" ? (
                        <td className="px-4 py-2.5 text-muted-foreground">
                          <div className="whitespace-nowrap">
                            {e.removedAt ? fmtDate(e.removedAt) : "—"}
                          </div>
                          <div className="text-[11px]">{e.removedBy}</div>
                          {e.removalReason ? (
                            <div className="text-[11px] whitespace-pre-wrap">{e.removalReason}</div>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        {canRemove && !e.removedAt ? (
                          <button
                            type="button"
                            className={TOOLBAR.button}
                            onClick={() => setRemoving(e)}
                            data-testid="dnc-row-remove"
                          >
                            {REMOVE_FROM_DNC_LABEL}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
      {removing ? (
        <DncActionDialog
          mode="remove"
          target={{
            applicationId: removing.applicationId ?? undefined,
            waitlistId: removing.waitlistId ?? undefined,
            name: removing.fullName,
          }}
          entryId={removing.id}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}
