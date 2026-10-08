import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./modal";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Upload, Camera, FileText, Loader2, ChevronLeft, AlertTriangle, CheckCircle2, RotateCw, Eye, Car, Copy, Link2,
} from "lucide-react";
import {
  createImportBatch, listImportBatches, registerInboxFile, analyzeInboxItem, getImportBatch,
  applyImportDecisions, classifyInboxItem, attachInboxItem, getFleetDocumentFile,
} from "@/lib/fleet-inbox.functions";
import { DOC_GROUPS, docClassLabel, FIELD_LABELS, HIGH_RISK, type Change } from "@/lib/fleet-inbox";
import { EmptyState, StatusPill } from "@/components/admin/ui";
import { ServiceTransactionReview } from "@/components/admin/ServiceTransactionReview";

const BATCH_LABEL: Record<string, string> = {
  uploading: "Uploading", processing: "Processing", ready: "Ready for Review", needs_attention: "Needs Attention",
  applied: "Applied", partially_applied: "Partially Applied", failed: "Failed",
};
const ITEM_LABEL: Record<string, string> = {
  uploaded: "Waiting to analyze", analyzing: "Analyzing", matching: "Matching", ready: "Ready for Review",
  needs_attention: "Needs Attention", failed: "Failed", duplicate: "Already uploaded", applied: "Applied",
};
const toneOf = (s: string) =>
  s === "failed" ? "red" : s === "needs_attention" || s === "conflict" || s === "partially_applied" ? "amber" : s === "applied" || s === "ready" ? "green" : "neutral";

type Decision = { action: "create" | "match" | "ignore" | null; vehicleId?: string; accept: Set<string>; confirm: Set<string>; applyFinance: boolean };

export function FleetInboxPanel({ isManager }: { isManager: boolean }) {
  const [batchId, setBatchId] = useState<string | null>(null);
  return batchId ? (
    <BatchView batchId={batchId} onBack={() => setBatchId(null)} isManager={isManager} />
  ) : (
    <InboxHome onOpen={setBatchId} />
  );
}

// ------------------------------------------------------------------ home + upload
function InboxHome({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useServerFn(listImportBatches);
  const create = useServerFn(createImportBatch);
  const register = useServerFn(registerInboxFile);
  const analyze = useServerFn(analyzeInboxItem);
  const [batches, setBatches] = useState<any[] | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setBatches(await list()), [list]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function ingest(files: File[]) {
    if (!files.length) return;
    const tooBig = files.filter((f) => f.size > 20 * 1024 * 1024);
    if (tooBig.length) toast.error(`${tooBig.length} file(s) over 20 MB were skipped.`);
    const ok = files.filter((f) => f.size <= 20 * 1024 * 1024);
    if (!ok.length) return;
    setBusy(`Uploading 0 of ${ok.length}…`);
    try {
      const { id } = await create({ data: {} });
      const itemIds: string[] = [];
      let dups = 0;
      for (let i = 0; i < ok.length; i++) {
        const f = ok[i];
        setBusy(`Uploading ${i + 1} of ${ok.length}…`);
        const ext = (f.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
        const path = `inbox/${id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("vehicle-docs").upload(path, f, { contentType: f.type || undefined });
        if (error) { toast.error(`Could not upload ${f.name}`); continue; }
        try {
          const r = await register({ data: { batchId: id, path, fileName: f.name, mimeType: f.type || null, sizeBytes: f.size } });
          if (r.duplicate) dups++; else itemIds.push(r.itemId);
        } catch { toast.error(`Could not register ${f.name}`); }
      }
      if (dups) toast.message(`${dups} file(s) were already uploaded and were not stored again.`);
      onOpen(id);
      // Analyze sequentially; one failure never stops the rest.
      for (const itemId of itemIds) {
        try { await analyze({ data: { itemId } }); } catch { /* recorded on the item */ }
      }
    } catch {
      toast.error("Could not start the import.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void ingest(Array.from(e.dataTransfer.files)); }}
        className={`rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-colors ${drag ? "border-[#D03020] bg-[rgba(208,48,32,0.04)]" : "border-[#E2E2E7] bg-white"}`}
      >
        <Upload className="w-8 h-8 mx-auto text-[#9A9AA3]" />
        <h2 className="mt-3 text-lg font-semibold text-[#111114]">Drop Fleet Files Here</h2>
        <p className="mt-1 text-sm text-[#55555E] max-w-md mx-auto">
          Titles, registrations, insurance, receipts, photos — one file or a whole stack. REAL RENTALS sorts each
          document, identifies the vehicles and prepares updates for you to review. Nothing changes until you approve it.
        </p>
        <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
          <button disabled={!!busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center justify-center gap-2 min-h-[44px] rounded-md bg-[#D03020] text-white px-5 text-sm font-medium disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {busy ?? "Upload Files"}
          </button>
          <button disabled={!!busy} onClick={() => camRef.current?.click()} className="sm:hidden inline-flex items-center justify-center gap-2 min-h-[44px] rounded-md border border-[#EDEDF0] bg-white px-5 text-sm font-medium">
            <Camera className="w-4 h-4" /> Take Photo
          </button>
        </div>
        <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void ingest(f); }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void ingest(f); }} />
      </div>

      <div>
        <h3 className="text-[13px] font-semibold text-[#111114] mb-2">Imports</h3>
        {batches === null ? (
          <p className="text-sm text-[#9A9AA3]">Loading…</p>
        ) : batches.length === 0 ? (
          <EmptyState title="No Imports Yet" hint="Uploaded files appear here as an import you can review." />
        ) : (
          <div className="rounded-xl border border-[#EDEDF0] bg-white divide-y divide-[#EDEDF0]">
            {batches.map((b) => (
              <button key={b.id} onClick={() => onOpen(b.id)} className="w-full text-left px-4 py-3 min-h-[44px] flex items-center gap-3 hover:bg-[#FAFAFB]">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[#111114] truncate">{b.label}</div>
                  <div className="text-xs text-[#9A9AA3]">
                    {b.source === "email" ? "Email · " : "Upload · "}{b.files} file{b.files === 1 ? "" : "s"} · {b.vehicles} vehicle entr{b.vehicles === 1 ? "y" : "ies"}
                    {b.newVehicles ? ` · ${b.newVehicles} new` : ""}{b.conflicts ? ` · ${b.conflicts} conflicts` : ""}
                  </div>
                </div>
                <StatusPill tone={toneOf(b.status) as any}>{BATCH_LABEL[b.status] ?? b.status}</StatusPill>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ batch review
function BatchView({ batchId, onBack, isManager }: { batchId: string; onBack: () => void; isManager: boolean }) {
  const get = useServerFn(getImportBatch);
  const apply = useServerFn(applyImportDecisions);
  const analyze = useServerFn(analyzeInboxItem);
  const classify = useServerFn(classifyInboxItem);
  const attach = useServerFn(attachInboxItem);
  const fileFn = useServerFn(getFleetDocumentFile);
  const [d, setD] = useState<any | null>(null);
  const [dec, setDec] = useState<Record<string, Decision>>({});
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    const r = await get({ data: { batchId } });
    setD(r);
    setDec((prev) => {
      const next = { ...prev };
      for (const p of r.proposals) {
        if (!next[p.id]) next[p.id] = { action: null, vehicleId: p.match_vehicle_id ?? undefined, accept: new Set(), confirm: new Set(), applyFinance: false };
      }
      return next;
    });
  }, [get, batchId]);
  useEffect(() => { void load(); }, [load]);
  // Poll while anything is still being processed.
  useEffect(() => {
    if (!d) return;
    const busy = d.items.some((i: any) => ["uploaded", "analyzing", "matching"].includes(i.status));
    if (!busy) return;
    // Fast while a file is being read; slower while files only wait for a scheduled retry.
    const active = d.items.some((i: any) => ["analyzing", "matching"].includes(i.status) || (i.status === "uploaded" && i.job?.state !== "retry_wait"));
    const t = setInterval(() => void load(), active ? 3000 : 15000);
    return () => clearInterval(t);
  }, [d, load]);
  // Email-delivered files arrive "waiting to analyze"; run the normal analysis once when staff open the import.
  const kicked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!d || d.batch.source_channel !== "email") return;
    const waiting = d.items.filter((i: any) => i.status === "uploaded" && !kicked.current.has(i.id));
    if (!waiting.length) return;
    waiting.forEach((i: any) => kicked.current.add(i.id));
    void (async () => { for (const i of waiting) { try { await analyze({ data: { itemId: i.id } }); } catch { /* shown as Failed */ } } void load(); })();
  }, [d, analyze, load]);

  const setOne = (id: string, patch: Partial<Decision>) => setDec((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  async function openFile(documentId: string) {
    try {
      const f = await fileFn({ data: { documentId } });
      const bin = atob(f.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { toast.error("Could not open the file."); }
  }

  const pending = useMemo(() => (d?.proposals ?? []).filter((p: any) => p.status === "pending" || p.status === "failed"), [d]);
  const selected = pending.filter((p: any) => dec[p.id]?.action);

  function selectAllSafe() {
    setDec((prev) => {
      const next = { ...prev };
      for (const p of pending) {
        const issuesBlock = (p.issues ?? []).some((s: string) => /not valid|conflict|unreadable/i.test(s));
        if (p.kind === "new" && !issuesBlock && p.vin_check?.formatValid) next[p.id] = { ...next[p.id], action: "create" };
        else if (p.kind === "match") {
          const safe = (p.changes as Change[]).filter((c) => c.safe).map((c) => c.field);
          next[p.id] = { ...next[p.id], action: "match", vehicleId: p.match_vehicle_id, accept: new Set(safe) };
        }
      }
      return next;
    });
  }

  async function commit() {
    setApplying(true);
    try {
      const decisions = selected.map((p: any) => {
        const x = dec[p.id];
        return { proposalId: p.id, action: x.action!, vehicleId: x.vehicleId, acceptFields: [...x.accept], confirmHighRisk: [...x.confirm], applyFinance: x.applyFinance };
      });
      const r = await apply({ data: { batchId, decisions } });
      setResults(r.results);
      const okN = r.results.filter((x) => x.ok).length;
      toast[okN === r.results.length ? "success" : "warning"](`${okN} of ${r.results.length} applied`);
      setConfirming(false);
      setDec({});
      await load();
    } catch { toast.error("Apply failed — nothing was claimed as done."); }
    finally { setApplying(false); }
  }

  if (!d) return <p className="text-sm text-[#9A9AA3]">Loading…</p>;
  const props = d.proposals as any[];
  const counts = {
    files: d.items.length,
    vehicles: props.length,
    newV: props.filter((p) => p.kind === "new").length,
    matched: props.filter((p) => p.kind === "match").length,
    conflicts: props.filter((p) => p.kind === "conflict").length,
    unclassified: d.items.filter((i: any) => i.doc_class === "unknown" || i.status === "failed").length,
    docs: new Set(d.items.filter((i: any) => i.status !== "duplicate").map((i: any) => i.document_id)).size,
  };
  const itemById = Object.fromEntries(d.items.map((i: any) => [i.id, i]));
  const vehLabel = (id: string) => { const v = d.vehicles.find((x: any) => x.id === id); return v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}${v.unit_number ? ` · ${v.unit_number}` : ""}${v.vin ? ` · …${String(v.vin).slice(-6)}` : ""}` : "—"; };
  const creates = selected.filter((p: any) => dec[p.id].action === "create");
  const matches = selected.filter((p: any) => dec[p.id].action === "match");
  const ignores = selected.filter((p: any) => dec[p.id].action === "ignore");
  const linkDocs = new Set([...creates, ...matches].map((p: any) => itemById[p.item_id]?.document_id)).size;

  return (
    <div className="space-y-5 pb-24">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-[13px] text-[#55555E] hover:text-[#111114] min-h-[44px]">
        <ChevronLeft className="w-4 h-4" /> Fleet Inbox
      </button>
      <div className="flex flex-wrap items-start gap-3 justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[#111114]">{d.batch.label}</h2>
          <p className="text-sm text-[#55555E]">{counts.vehicles} Vehicle{counts.vehicles === 1 ? "" : "s"} Found{(d.transactions ?? []).length ? ` · ${(d.transactions ?? []).length} Service Transaction${(d.transactions ?? []).length === 1 ? "" : "s"}` : ""}</p>
        </div>
        <StatusPill tone={toneOf(d.batch.status) as any}>{BATCH_LABEL[d.batch.status] ?? d.batch.status}</StatusPill>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          ["Files", counts.files], ["Source documents", counts.docs], ["New vehicles", counts.newV],
          ["Existing matches", counts.matched], ["Conflicts", counts.conflicts], ["Couldn't classify", counts.unclassified],
        ].map(([l, n]) => (
          <div key={l as string} className="rounded-xl border border-[#EDEDF0] bg-white px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-[#9A9AA3]">{l}</div>
            <div className="text-lg font-semibold text-[#111114]">{n}</div>
          </div>
        ))}
      </div>

      {d.email && (
        <section className="rounded-xl border border-[#EDEDF0] bg-white">
          <header className="px-4 py-3 border-b border-[#EDEDF0] text-[13px] font-semibold">Received by Email</header>
          <div className="px-4 py-3 space-y-1 text-sm">
            <div><span className="text-[#9A9AA3]">From:</span> {d.email.from_name ? `${d.email.from_name} <${d.email.from_address}>` : d.email.from_address}</div>
            <div><span className="text-[#9A9AA3]">Subject:</span> {d.email.subject || "(No Subject)"}</div>
            <div><span className="text-[#9A9AA3]">Received:</span> {new Date(d.email.received_at).toLocaleString("en-US", { timeZone: "America/New_York" })}</div>
            {(d.email.attachments ?? []).filter((a: any) => a.outcome && a.outcome !== "stored" && a.outcome !== "duplicate_of_existing").map((a: any, i: number) => (
              <div key={i} className="text-xs text-[#B45309]">{a.file_name ?? "Attachment"} — Not Imported ({String(a.outcome).replace(/_/g, " ")})</div>
            ))}
            {d.email.text_body && (
              <details className="pt-1"><summary className="cursor-pointer text-xs text-[#55555E]">Show Email Body</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-[#33333A] max-h-80 overflow-auto bg-[#FAFAFB] rounded-md p-3">{d.email.text_body}</pre>
              </details>
            )}
          </div>
        </section>
      )}

      {d.queue?.pausedReason && (
        <div role="status" className="rounded-xl border border-[#F5C26B] bg-[#FFF8EB] px-4 py-3 text-sm text-[#7A4B00]">
          Automatic Analysis Is Paused — {d.queue.pausedReason}. Files stay queued and resume on their own once this is resolved.
        </div>
      )}

      <ServiceTransactionReview d={d} isManager={isManager} reload={load} openFile={openFile} />

      {/* Files */}
      <section className="rounded-xl border border-[#EDEDF0] bg-white">
        <header className="px-4 py-3 border-b border-[#EDEDF0] text-[13px] font-semibold">Files</header>
        <div className="divide-y divide-[#EDEDF0]">
          {d.items.map((it: any) => (
            <div key={it.id} className="px-4 py-3 flex flex-wrap items-center gap-2">
              <FileText className="w-4 h-4 text-[#9A9AA3] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{it.file_name}</div>
                <div className="text-xs text-[#9A9AA3]">
                  {docClassLabel(it.doc_class)}{it.class_confidence && it.doc_class ? ` · ${it.class_confidence} confidence` : ""}
                  {it.extraction ? ` · ${it.extraction.vehicleCount} vehicle entr${it.extraction.vehicleCount === 1 ? "y" : "ies"}` : ""}
                  {it.error ? ` · ${it.error}` : ""}
                </div>
                {it.job && it.job.state === "retry_wait" && (
                  <div className="text-xs text-[#B45309] mt-0.5">Retrying Automatically · Attempt {it.job.attempts + 1} Of {it.job.maxAttempts}{it.job.nextRunAt ? ` · Next Try ${new Date(it.job.nextRunAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}` : ""}</div>
                )}
                {it.job && it.job.state === "queued" && it.status === "uploaded" && <div className="text-xs text-[#9A9AA3] mt-0.5">Queued For Automatic Analysis</div>}
                {it.job && it.job.state === "dead" && it.status === "failed" && <div className="text-xs text-[#D03020] mt-0.5">Automatic Retries Used Up · Use Retry Analysis</div>}
                {(it.warnings ?? []).length > 0 && <div className="text-xs text-[#B45309] mt-0.5">{it.warnings.slice(0, 2).join(" · ")}</div>}
              </div>
              <StatusPill tone={toneOf(it.status) as any}>
                {["analyzing", "matching", "uploaded"].includes(it.status) && <Loader2 className="w-3 h-3 animate-spin inline mr-1" />}
                {it.status === "duplicate" && <Copy className="w-3 h-3 inline mr-1" />}
                {ITEM_LABEL[it.status] ?? it.status}
              </StatusPill>
              {it.document_id && (
                <button onClick={() => openFile(it.document_id)} className="min-h-[36px] px-2 text-xs inline-flex items-center gap-1 text-[#55555E] hover:text-[#111114]"><Eye className="w-3.5 h-3.5" /> View</button>
              )}
              {["failed", "needs_attention"].includes(it.status) && (
                <button onClick={async () => { const r = await analyze({ data: { itemId: it.id } }); if (!r.ok) toast.error(r.error); void load(); }} className="min-h-[36px] px-2 text-xs inline-flex items-center gap-1 text-[#D03020]"><RotateCw className="w-3.5 h-3.5" /> Retry Analysis</button>
              )}
              {!["duplicate", "analyzing", "applied"].includes(it.status) && (
                <select aria-label="Classify manually" value="" onChange={async (e) => { if (!e.target.value) return; await classify({ data: { itemId: it.id, docClass: e.target.value } }); void load(); }}
                  className="min-h-[36px] rounded-md border border-[#EDEDF0] bg-white text-xs px-2">
                  <option value="">Classify…</option>
                  {DOC_GROUPS.map((g) => (
                    <optgroup key={g.group} label={g.group}>{g.classes.map((c) => <option key={c} value={c}>{docClassLabel(c)}</option>)}</optgroup>
                  ))}
                </select>
              )}
              {it.document_id && it.status !== "duplicate" && d.vehicles.length > 0 && (
                <select aria-label="Attach to vehicle" value="" onChange={async (e) => { if (!e.target.value) return; const r = await attach({ data: { itemId: it.id, vehicleId: e.target.value } }); r.ok ? toast.success("Attached") : toast.error(r.error); }}
                  className="min-h-[36px] rounded-md border border-[#EDEDF0] bg-white text-xs px-2 max-w-[180px]">
                  <option value="">Attach to vehicle…</option>
                  {d.vehicles.map((v: any) => <option key={v.id} value={v.id}>{vehLabel(v.id)}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      </section>

      {results && (
        <section className="rounded-xl border border-[#EDEDF0] bg-white p-4 space-y-1">
          <div className="text-[13px] font-semibold mb-1">Last apply</div>
          {results.map((r) => (
            <div key={r.proposalId} className={`text-xs ${r.ok ? "text-emerald-700" : "text-[#D03020]"}`}>
              {r.ok ? <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> : <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />}
              {(props.find((p) => p.id === r.proposalId)?.vin ?? "Entry")} — {r.message}
            </div>
          ))}
        </section>
      )}

      {/* Proposals */}
      {props.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-semibold mr-auto">Vehicles</h3>
          <button onClick={selectAllSafe} disabled={!pending.length} className="min-h-[44px] rounded-md border border-[#EDEDF0] bg-white px-4 text-sm font-medium disabled:opacity-40">Select All Safe</button>
        </div>
      )}
      <div className="space-y-3">
        {props.map((p) => (
          <ProposalCard key={p.id} p={p} item={itemById[p.item_id]} dec={dec[p.id]} setOne={(patch) => setOne(p.id, patch)}
            vehicles={d.vehicles} vehLabel={vehLabel} finance={d.finance.filter((f: any) => f.proposal_id === p.id)} isManager={isManager} />
        ))}
      </div>

      {selected.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 md:left-auto md:right-6 md:bottom-6 md:w-auto z-30 bg-white border-t md:border md:rounded-xl border-[#EDEDF0] shadow-lg p-3 flex items-center gap-3">
          <span className="text-sm text-[#55555E]">{selected.length} selected</span>
          <button onClick={() => setConfirming(true)} className="min-h-[44px] rounded-md bg-[#D03020] text-white px-5 text-sm font-medium ml-auto">
            {creates.length && !matches.length ? "Create Selected" : "Apply Selected"}
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog title="Before You Apply" onCancel={() => setConfirming(false)} onConfirm={commit} busy={applying}
          confirmLabel={applying ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply"}>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
            {creates.length > 0 && <li>{creates.length} vehicle{creates.length === 1 ? "" : "s"} will be created</li>}
            {matches.length > 0 && <li>{matches.length} existing vehicle{matches.length === 1 ? "" : "s"} updated with accepted changes</li>}
            {ignores.length > 0 && <li>{ignores.length} entr{ignores.length === 1 ? "y" : "ies"} ignored</li>}
            {linkDocs > 0 && <li>{linkDocs} document{linkDocs === 1 ? "" : "s"} linked (stored once)</li>}
            {creates.length + matches.length > 0 && <li>{creates.length + matches.length} document relationship{creates.length + matches.length === 1 ? "" : "s"} created</li>}
            {creates.length > 0 && <li>Extracted fields, including shared insurance, applied to new vehicles</li>}
          </ul>
          <p className="text-xs text-muted-foreground">Everything is re-checked on the server first.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function ProposalCard({ p, item, dec, setOne, vehicles, vehLabel, finance, isManager }: {
  p: any; item: any; dec?: Decision; setOne: (patch: Partial<Decision>) => void; vehicles: any[];
  vehLabel: (id: string) => string; finance: any[]; isManager: boolean;
}) {
  if (!dec) return null;
  const done = p.status === "applied" || p.status === "ignored";
  const title = [p.identity?.year, p.identity?.make, p.identity?.model].filter(Boolean).join(" ") || "Unidentified vehicle";
  const changes = (p.changes ?? []) as Change[];
  const heading =
    p.kind === "new" ? "New vehicle detected" : p.kind === "match" ? `Matches ${vehLabel(p.match_vehicle_id)}` :
    p.kind === "conflict" ? "Review required — conflict" : "Couldn't identify vehicle";
  const toggle = (set: Set<string>, f: string) => { const n = new Set(set); n.has(f) ? n.delete(f) : n.add(f); return n; };

  return (
    <div className={`rounded-xl border bg-white p-4 ${p.kind === "conflict" ? "border-[#F59E0B]" : "border-[#EDEDF0]"} ${done ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start gap-2">
        <Car className="w-4 h-4 mt-0.5 text-[#9A9AA3]" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-[#9A9AA3]">{heading}</div>
          <div className="text-[15px] font-semibold text-[#111114]">{title}</div>
          <div className="text-xs text-[#55555E] break-all">
            VIN {p.vin ?? "—"}{p.vin_check?.checkDigitValid === true ? " ✓" : ""}
            {" · "}Source: {item?.file_name ?? "file"}{p.page ? `, page ${p.page}` : ""}
            {p.match_basis ? ` · matched by ${p.match_basis.replace("_", " ")}` : ""}
          </div>
        </div>
        {done ? (
          <StatusPill tone={p.status === "applied" ? "green" : "neutral"}>{p.status === "applied" ? "Applied" : "Ignored"}</StatusPill>
        ) : p.status === "failed" ? <StatusPill tone="red">Failed — {p.result?.message ?? ""}</StatusPill> : null}
      </div>

      <ServiceSummary fields={p.fields} />

      {(p.issues ?? []).length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {p.issues.map((s: string) => <li key={s} className="text-xs text-[#B45309] flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{s}</li>)}
        </ul>
      )}

      {changes.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs min-w-[420px]">
            <thead><tr className="text-left text-[#9A9AA3]">
              {p.kind !== "new" && !done && <th className="py-1 w-6"></th>}
              <th className="py-1">Field</th>{p.kind !== "new" && <th>Current</th>}<th>{p.kind === "new" ? "Value" : "Proposed"}</th><th>Confidence</th>
            </tr></thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.field} className="border-t border-[#F2F2F4]">
                  {p.kind !== "new" && !done && (
                    <td className="py-1.5">
                      <input type="checkbox" aria-label={`Accept ${c.label}`} checked={dec.accept.has(c.field)}
                        onChange={() => setOne({ accept: toggle(dec.accept, c.field), action: dec.action ?? "match", vehicleId: dec.vehicleId ?? p.match_vehicle_id })} />
                    </td>
                  )}
                  <td className="py-1.5 font-medium">{c.label}{c.risk === "high" && <span className="ml-1 text-[10px] text-[#D03020]">HIGH-RISK</span>}</td>
                  {p.kind !== "new" && <td className="text-[#9A9AA3]">{c.current ?? "—"}</td>}
                  <td className={c.kind === "conflict" ? "text-[#B45309] font-medium" : ""}>{c.proposed}{c.note ? <div className="text-[10px] text-[#B45309]">{c.note}</div> : null}</td>
                  <td>{c.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.kind !== "new" && !done && changes.some((c) => (HIGH_RISK.has(c.field) || c.kind === "conflict") && dec.accept.has(c.field)) && (
            <div className="mt-2 space-y-1">
              {changes.filter((c) => (HIGH_RISK.has(c.field) || c.kind === "conflict") && dec.accept.has(c.field)).map((c) => (
                <label key={c.field} className="flex items-center gap-2 text-xs text-[#D03020]">
                  <input type="checkbox" checked={dec.confirm.has(c.field)} onChange={() => setOne({ confirm: toggle(dec.confirm, c.field) })} />
                  I confirm changing {c.label} from {c.current ?? "blank"} to {c.proposed} based on this document
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {isManager && finance.length > 0 && !done && (
        <div className="mt-3 rounded-lg bg-[#FAFAFB] p-3 text-xs space-y-1">
          <div className="font-semibold">Finance details found (Owner/Manager only)</div>
          {finance.map((f) => (
            <label key={f.field} className="flex items-center gap-2">
              <input type="checkbox" checked={dec.confirm.has(f.field)} onChange={() => setOne({ confirm: toggle(dec.confirm, f.field), applyFinance: true })} />
              {FIELD_LABELS[f.field] ?? f.field}: <span className="font-medium">{f.value}</span> <span className="text-[#9A9AA3]">({f.confidence})</span>
            </label>
          ))}
          <div className="text-[#9A9AA3]">Only fills blanks in the vehicle's finance record; never overwrites.</div>
        </div>
      )}

      {!done && (
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          {p.kind === "new" && (
            <ActionBtn active={dec.action === "create"} onClick={() => setOne({ action: dec.action === "create" ? null : "create" })} disabled={!p.vin_check?.formatValid}>Create Vehicle</ActionBtn>
          )}
          <ActionBtn active={dec.action === "match"} onClick={() => setOne({ action: dec.action === "match" ? null : "match", vehicleId: dec.vehicleId ?? p.match_vehicle_id ?? vehicles[0]?.id })} disabled={!vehicles.length}>
            <Link2 className="w-3.5 h-3.5" /> {p.kind === "new" ? "Match Existing" : "Apply to Vehicle"}
          </ActionBtn>
          {dec.action === "match" && (
            <select value={dec.vehicleId ?? ""} onChange={(e) => setOne({ vehicleId: e.target.value })} className="min-h-[44px] rounded-md border border-[#EDEDF0] bg-white text-xs px-2 max-w-full">
              {vehicles.map((v) => <option key={v.id} value={v.id}>{vehLabel(v.id)}</option>)}
            </select>
          )}
          <ActionBtn active={dec.action === "ignore"} onClick={() => setOne({ action: dec.action === "ignore" ? null : "ignore" })}>Ignore</ActionBtn>
          {p.kind !== "new" && changes.some((c) => c.safe) && (
            <button onClick={() => setOne({ action: "match", vehicleId: dec.vehicleId ?? p.match_vehicle_id, accept: new Set(changes.filter((c) => c.safe).map((c) => c.field)) })}
              className="min-h-[44px] px-3 text-xs text-[#D03020]">Accept Safe Changes</button>
          )}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`min-h-[44px] px-4 rounded-md text-sm font-medium inline-flex items-center gap-1.5 border disabled:opacity-40 ${active ? "bg-[#111114] text-white border-[#111114]" : "bg-white border-[#EDEDF0] text-[#111114]"}`}>
      {children}
    </button>
  );
}

/** Proposed service event, shown before anything changes vehicle history. */
function ServiceSummary({ fields }: { fields: any }) {
  const f = (k: string) => fields?.[k]?.value as string | undefined;
  if (!f("service_date") && !f("vendor") && !f("service_items") && !f("service_description") && !f("total")) return null;
  let items: { description: string; amount: number | null }[] = [];
  try { items = JSON.parse(f("service_items") ?? "[]"); } catch { items = []; }
  if (!items.length && f("service_description")) items = [{ description: String(f("service_description")), amount: null }];
  const Cell = ({ k, v }: { k: string; v?: string | null }) => (
    <div><div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9A9AA3]">{k}</div><div className="text-[13px] text-[#111114]">{v || "Unknown"}</div></div>
  );
  return (
    <div className="mt-3 rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] p-3">
      <div className="mb-2 text-[12px] font-semibold text-[#111114]">Proposed Service Record</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cell k="Service Date" v={f("service_date")} />
        <Cell k="Vendor" v={f("vendor")} />
        <Cell k="Mileage" v={f("current_odometer") ? `${Number(f("current_odometer")).toLocaleString("en-US")} mi` : null} />
        <Cell k="Total" v={f("total") ? `$${f("total")}` : null} />
      </div>
      {items.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-[#55555E]">
          {items.map((i, n) => <li key={n}>• {i.description}{i.amount != null ? ` — $${i.amount}` : ""}</li>)}
        </ul>
      )}
      <div className="mt-2 text-[11px] text-[#9A9AA3]">Approving creates one service record, one linked expense and one dated mileage reading, all pointing back to this document.</div>
    </div>
  );
}
