// Vehicle profile completion: shows document-backed suggestions already
// extracted by Fleet Inbox and applies accepted ones through the same
// server apply path (blanks only, provenance + audit, Owner-only fields guarded).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, X, FileText, AlertTriangle } from "lucide-react";
import { getVehicleSuggestions, applyImportDecisions } from "@/lib/fleet-inbox.functions";

type Sug = {
  proposalId: string; batchId: string; fileName: string; docClass: string | null; page: number | null;
  field: string; label: string; current: string | null; proposed: string; confidence: string;
  safe: boolean; risk: string; evidence: { raw: string | null; note: string | null };
};

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function VehicleSuggestions({ vehicleId, canEdit, onApplied, batchId, inline = false }: {
  vehicleId: string; canEdit: boolean; onApplied: () => void;
  /** Only show details read from this upload (Vehicle Profile upload dialog). */
  batchId?: string;
  /** Render the review list directly (inside another dialog) instead of a button + popup. */
  inline?: boolean;
}) {
  const load = useServerFn(getVehicleSuggestions);
  const apply = useServerFn(applyImportDecisions);
  const [data, setData] = useState<{ suggestions: Sug[]; conflicts: Sug[]; possibleMatches: any[]; needsVerification?: any[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r: any = await load({ data: { vehicleId } });
      if (batchId) {
        const only = (xs: any[]) => (xs ?? []).filter((x) => x.batchId === batchId);
        setData({ ...r, suggestions: only(r.suggestions), conflicts: only(r.conflicts), possibleMatches: only(r.possibleMatches), needsVerification: only(r.needsVerification) });
      } else setData(r);
    } catch { setData(null); }
  }, [load, vehicleId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (inline) setOpen(true); }, [inline]);

  const key = (s: Sug) => `${s.proposalId}:${s.field}`;
  const sugs = data?.suggestions ?? [];
  const safeKeys = useMemo(() => sugs.filter((s) => s.safe).map(key), [sugs]);
  const count = sugs.length;
  if (!data || (count === 0 && !data.possibleMatches.length && !data.conflicts.length && !(data.needsVerification ?? []).length)) {
    return inline && data ? <p className="text-[12px] text-[#55555E]">No new details to add — this vehicle already has every value the document shows.</p> : null;
  }

  async function submit(keys: string[]) {
    if (!keys.length) return;
    setBusy(true); setMsg(null);
    try {
      const chosen = sugs.filter((s) => keys.includes(key(s)));
      const byBatch = new Map<string, Map<string, string[]>>();
      for (const s of chosen) {
        const b = byBatch.get(s.batchId) ?? new Map(); const f = b.get(s.proposalId) ?? [];
        f.push(s.field); b.set(s.proposalId, f); byBatch.set(s.batchId, b);
      }
      let applied = 0; const errors: string[] = [];
      for (const [batchId, props] of byBatch) {
        const res = await apply({ data: { batchId, decisions: [...props].map(([proposalId, fields]) => ({
          proposalId, action: "match" as const, vehicleId, acceptFields: fields, confirmHighRisk: fields, applyFinance: false, partial: true,
        })) } });
        for (const r of res.results) { if (r.ok) applied += Number(/(\d+) change/.exec(r.message ?? "")?.[1] ?? 0); else errors.push(r.message); }
      }
      setMsg(errors.length ? errors.join(" ") : applied ? `Saved ${applied} Detail${applied === 1 ? "" : "s"}.` : "Nothing Saved — Those Fields Already Have Values.");
      setPicked(new Set());
      await refresh(); onApplied();
    } catch (e: any) { setMsg(e?.message ?? "Could not save."); } finally { setBusy(false); }
  }

  return (
    <>
      {!inline && (
      <button onClick={() => setOpen(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[#EDEDF0] bg-[#FAFAFB] px-2.5 py-1 text-[11px] font-medium text-[#111114] hover:bg-white">
        <Sparkles className="w-3 h-3 text-[#D03020]" />
        {count > 0 ? `${count} Detail${count === 1 ? "" : "s"} Found` : "Document Matches To Review"}
        <span className="text-[#D03020]">Review</span>
      </button>
      )}
      {open && (
        <div className={inline ? "" : "fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"} onClick={() => !inline && setOpen(false)}>
          <div role={inline ? "region" : "dialog"} aria-label="Details Found In Documents" className={inline ? "" : "w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-5"} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[16px] font-semibold text-[#111114]">Details Found In Documents</h3>
              {!inline && <button aria-label="Close" onClick={() => setOpen(false)}><X className="w-4 h-4" /></button>}
            </div>
            <p className="text-[12px] text-[#55555E] mb-4">Only blank fields are filled. Existing values are never overwritten. VIN, plate and mileage need individual approval.</p>

            {sugs.map((s) => (
              <label key={key(s)} className="flex gap-3 border border-[#EDEDF0] rounded-xl p-3 mb-2 cursor-pointer">
                {canEdit && <input type="checkbox" className="mt-1" checked={picked.has(key(s))} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(key(s)) : n.delete(key(s)); setPicked(n); }} />}
                <div className="min-w-0 flex-1 text-[12px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#111114]">{s.label.replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                    <span className={s.field === "body_type" ? "text-[#111114]" : "font-mono text-[#111114]"}>{s.field === "body_type" ? titleCase(s.proposed) : s.proposed}</span>
                    <span className="rounded-full bg-[#F2F2F4] px-2 py-0.5 text-[10px]">{titleCase(s.confidence)} Confidence</span>
                    {!s.safe && <span className="rounded-full bg-[#FFF4E5] px-2 py-0.5 text-[10px] text-[#8A4B00]">Confirm Individually</span>}
                  </div>
                  <div className="text-[#55555E] mt-1">Current: {s.current ?? "Not Set"}</div>
                  <div className="text-[#55555E] mt-0.5 flex items-center gap-1"><FileText className="w-3 h-3" /> {s.fileName}{s.docClass ? ` · ${titleCase(s.docClass)}` : ""}{s.page ? ` · Page ${s.page}` : ""}</div>
                  {(s.evidence.raw || s.evidence.note) && <div className="text-[#55555E] mt-0.5">Evidence: “{s.evidence.raw}”{s.evidence.note ? ` (${s.evidence.note})` : ""}</div>}
                </div>
              </label>
            ))}

            {(data.needsVerification ?? []).length > 0 && (
              <div className="mt-3 text-[12px]">
                <div className="font-semibold mb-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-[#8A4B00]" /> Needs Verification — Not Applied</div>
                {(data.needsVerification ?? []).map((v: any) => (
                  <div key={`${v.proposalId}:${v.field}`} className="text-[#55555E] mb-1">
                    {titleCase(v.label)}: document shows “{v.proposed}”. {v.note} ({v.fileName}{v.page ? ` · Page ${v.page}` : ""})
                  </div>
                ))}
              </div>
            )}
            {data.conflicts.length > 0 && (
              <div className="mt-3 text-[12px]">
                <div className="font-semibold mb-1">Conflicts — Not Applied</div>
                {data.conflicts.map((c) => <div key={key(c)} className="text-[#55555E]">{c.label}: on file {c.current}, document says {c.proposed} ({c.fileName})</div>)}
              </div>
            )}
            {data.possibleMatches.length > 0 && (
              <div className="mt-3 text-[12px]">
                <div className="font-semibold mb-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-[#8A4B00]" /> Possible Matches — Review In Fleet Inbox</div>
                {data.possibleMatches.map((m: any) => <div key={m.proposalId} className="text-[#55555E]">{m.fileName}: {m.reason}</div>)}
              </div>
            )}

            {msg && <div className="mt-3 text-[12px] text-[#111114]">{msg}</div>}
            {canEdit && sugs.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button disabled={busy || !safeKeys.length} onClick={() => submit(safeKeys)} className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-[12px] font-medium disabled:opacity-50">Approve Safe Fields ({safeKeys.length})</button>
                <button disabled={busy || !picked.size} onClick={() => submit([...picked])} className="rounded-md bg-[#D03020] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">Accept Selected ({picked.size})</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
