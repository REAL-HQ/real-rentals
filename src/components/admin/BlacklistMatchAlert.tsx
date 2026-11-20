import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { clearBlacklistLeadMatch, listBlacklistMatches } from "@/lib/blacklist.functions";
import { identifierKindLabel, type BlacklistMatchRow } from "@/lib/blacklist";

const SOURCE_LABEL: Record<BlacklistMatchRow["sourceTable"], string> = {
  applications: "Application",
  waitlist: "Waitlist Signup",
  contact_leads: "Website Lead",
};

/**
 * Loud red alert: this person (or these records) match a blacklisted renter.
 * Shows which fields matched and who they matched. Never declines anything:
 * staff decide. Only an Owner can clear ("Not The Same Person").
 *
 * - With applicationId: the matches for that one driver profile.
 * - Without: every open match (Drivers list header), including waitlist and website leads.
 */
export function BlacklistMatchAlert({ applicationId, canClear, onOpenApplication }: { applicationId?: string; canClear: boolean; onOpenApplication?: (id: string) => void }) {
  const load = useServerFn(listBlacklistMatches);
  const clear = useServerFn(clearBlacklistLeadMatch);
  const [rows, setRows] = useState<BlacklistMatchRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load({ data: applicationId ? { sourceTable: "applications", sourceId: applicationId } : {} })
      .then((r) => { if (!cancelled) setRows(r.matches); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [applicationId, load, tick]);
  if (!rows.length) return null;
  async function onClear(row: BlacklistMatchRow) {
    if (busy) return;
    const note = window.prompt("Why Is This Not The Same Person? (Saved To History)") ?? "";
    if (!note.trim()) return;
    setBusy(row.id);
    try {
      await clear({ data: { matchId: row.id, note: note.trim() } });
      toast.success("Blacklist Match Cleared");
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Clear The Match.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div role="alert" data-blacklist-match-alert className="mb-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <ShieldAlert className="h-4 w-4 text-rose-700" aria-hidden />
        {applicationId ? "Blacklist Match" : `${rows.length} Blacklist ${rows.length === 1 ? "Match Needs" : "Matches Need"} Review`}
      </div>
      <p className="mb-2 text-xs text-rose-800">Never Auto-Approved. Staff Can Still Talk To Them; An Owner Decides Whether It Is The Same Person.</p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            {!applicationId ? (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800">{SOURCE_LABEL[r.sourceTable]}</span>
            ) : null}
            <span className="min-w-0 flex-1">
              Matches <strong>{r.matchedName ?? "A Blacklisted Renter"}</strong> On {r.matchedKinds.map(identifierKindLabel).join(", ")}
            </span>
            {!applicationId && r.sourceTable === "applications" && onOpenApplication ? (
              <button type="button" onClick={() => onOpenApplication(r.sourceId)} className="text-xs font-medium underline">Open</button>
            ) : null}
            {canClear ? (
              <button type="button" disabled={busy === r.id} onClick={() => void onClear(r)} className="inline-flex h-7 items-center rounded-md border border-[#D6D6DB] bg-white px-2.5 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50">
                {busy === r.id ? "Clearing…" : "Not The Same Person"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
