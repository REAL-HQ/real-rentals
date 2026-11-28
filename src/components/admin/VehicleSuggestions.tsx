// Vehicle profile completion: shows document-backed suggestions already
// extracted by Fleet Inbox and applies accepted ones through the same
// server apply path (blanks only, provenance + audit, Owner-only fields guarded).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, X, FileText, AlertTriangle, ZoomIn, ZoomOut } from "lucide-react";
import { getVehicleSuggestions, applyImportDecisions } from "@/lib/fleet-inbox.functions";
import { previewKind } from "@/lib/fleet-file-preview";
import { loadStaffPhoto } from "@/lib/photoUrl";
import { sourcePageNumber } from "@/lib/suggestion-source-file";
import { loadStaffVehicleDocUrl } from "@/lib/vehicle-doc-url";
import { SourceDocThumb, SourcePdfPage } from "@/components/admin/SourceDocThumb";

type SourceRef = {
  fileName: string;
  docClass?: string | null;
  page?: number | null;
  photoPath?: string | null;
  fromPhoto?: boolean;
  storageBucket?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  /** Local fixture URL. Production rows never set this. */
  resolvedUrl?: string | null;
};

type Sug = SourceRef & {
  proposalId: string; batchId: string; fileName: string; docClass: string | null; page: number | null;
  field: string; label: string; current: string | null; proposed: string; confidence: string;
  safe: boolean; risk: string; evidence: { raw: string | null; note: string | null };
  /** Set when the evidence is a photograph in the private vehicle-photos bucket. */
  photoPath?: string | null;
  fromPhoto?: boolean;
};

type ViewFile = {
  fileName: string;
  docClass: string | null;
  page: number | null;
  mimeType: string | null;
  forceImage: boolean;
};

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The photograph a value was read from.
 *
 * Bytes come through loadStaffPhoto — the browser's own staff-authenticated
 * storage download — so an unpublished photo stays unreachable to anyone the
 * storage policy would refuse. Nothing is proxied and no URL is signed here.
 */
function EvidencePhoto({ path, onOpen, onPreview }: { path: string; onOpen: (url: string) => void; onPreview?: () => void }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let live = true;
    setBroken(false);
    void loadStaffPhoto(path).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [path]);
  return (
    <button
      type="button"
      data-testid="suggestion-source-thumb"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!url) return;
        onPreview?.();
        onOpen(url);
      }}
      className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[#EDEDF0] bg-[#F4F4F6]"
      aria-label="View The Photograph This Was Read From"
      aria-busy={url === undefined}
    >
      {url === undefined && <span className="absolute inset-0 animate-pulse bg-[#F2F2F4]" aria-hidden />}
      {url && !broken && <img src={url} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />}
      {(url === null || broken) && (
        <span className="absolute inset-0 grid place-items-center text-[#55555E]">
          <FileText className="h-5 w-5" />
        </span>
      )}
    </button>
  );
}

function metaOf(s: SourceRef): ViewFile {
  return {
    fileName: s.fileName || "Document",
    docClass: s.docClass ?? null,
    page: s.page ?? null,
    mimeType: s.mimeType ?? null,
    forceImage: !!(s.photoPath || s.fromPhoto),
  };
}

function sourceLine(s: SourceRef): string {
  return `${s.fileName || "Document"}${s.docClass ? ` · ${titleCase(s.docClass)}` : ""}${s.page ? ` · Page ${s.page}` : ""}`;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

function SourceLightbox({
  viewing,
  file,
  pending,
  onClose,
}: {
  viewing: string | null;
  file: ViewFile;
  pending: boolean;
  onClose: () => void;
}) {
  const kind = file.forceImage ? "image" : previewKind(file.mimeType, file.fileName);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [imgFailed, setImgFailed] = useState(false);
  const [pdfFailed, setPdfFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const subtitle = [file.docClass ? titleCase(file.docClass) : null, file.page ? `Page ${file.page}` : null].filter(Boolean).join(" · ");
  const canZoom = (kind === "image" && !!viewing && !imgFailed) || (kind === "pdf" && !!viewing && !pdfFailed);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImgFailed(false);
    setPdfFailed(false);
  }, [viewing, file.fileName, file.page]);

  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + 0.5) * 10) / 10));
      if (e.key === "-" || e.key === "_") setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - 0.5) * 10) / 10));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 });
  }, [zoom]);

  const stage = (node: ReactNode) => (
    <div
      className="flex max-h-full max-w-full items-center justify-center"
      style={{ cursor: zoom > 1 ? "grab" : "zoom-in", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }}
      onPointerDown={(e) => {
        if (zoom <= 1) {
          drag.current = { x: e.clientX, y: e.clientY, px: 0, py: 0, moved: false };
          return;
        }
        drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || zoom <= 1) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.hypot(dx, dy) > 4) d.moved = true;
        setPan({ x: d.px + dx, y: d.py + dy });
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved) return;
        setZoom((z) => (z <= 1 ? 2 : 1));
      }}
    >
      {node}
    </div>
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.fileName}
      data-testid="suggestion-source-lightbox"
      className="fixed inset-0 z-[120] flex flex-col bg-[#111114]"
      onClick={onClose}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-[#2A2A30] bg-[#111114] px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{file.fileName}</div>
          {subtitle && <div className="truncate text-[12px] text-[#C8C8CE]">{subtitle}</div>}
        </div>
        {canZoom && (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="Zoom Out" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - 0.5) * 10) / 10))} className="rounded-md p-2 hover:bg-[#2A2A30] disabled:opacity-30">
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="w-10 text-center text-[11px] tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Zoom In" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + 0.5) * 10) / 10))} className="rounded-md p-2 hover:bg-[#2A2A30] disabled:opacity-30">
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        )}
        <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="shrink-0 rounded-md p-2 hover:bg-[#2A2A30]">
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#2A2A30] p-4" onClick={onClose}>
        <div className="flex max-h-full max-w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
          {pending && !viewing ? (
            <span aria-busy="true" aria-label="Loading Document" className="h-[70vh] w-[min(480px,80vw)] animate-pulse rounded-lg bg-[#3A3A42]" />
          ) : kind === "image" && viewing && !imgFailed ? stage(
            <img src={viewing} alt={file.fileName} draggable={false} onError={() => setImgFailed(true)} className="max-h-[90vh] max-w-full object-contain" />,
          ) : kind === "pdf" && viewing && !pdfFailed ? stage(
            <SourcePdfPage url={viewing} page={file.page} mode="full" onFail={() => setPdfFailed(true)} />,
          ) : kind === "pdf" && viewing && pdfFailed ? (
            <iframe title={file.fileName} src={`${viewing}#page=${sourcePageNumber(file.page)}`} className="h-[80vh] w-full max-w-4xl rounded-lg bg-white" />
          ) : (
            <div className="px-6 text-center text-[13px] text-[#C8C8CE]">
              <FileText className="mx-auto mb-3 h-8 w-8" />
              This File Could Not Be Loaded.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function VehicleSuggestions({ vehicleId, canEdit, onApplied, batchId, inline = false, emptyText, onCount, openSignal, fixture }: {
  vehicleId: string; canEdit: boolean;
  /**
   * How many vehicle fields were actually written. 0 means the server refused,
   * or every chosen field already had a value — neither is a change, and a
   * caller must not act as though the vehicle moved.
   */
  onApplied: (fieldsWritten: number) => void;
  /** Only show details read from this upload (Vehicle Profile upload dialog). */
  batchId?: string;
  /** Render the review list directly (inside another dialog) instead of a button + popup. */
  inline?: boolean;
  /**
   * What to say, in inline mode, when there is nothing to review. The caller
   * knows WHY it is empty — duplicate, failed read, another car's document —
   * and this component does not; passing null keeps it silent.
   */
  emptyText?: string | null;
  /** How many details are waiting, so another card can offer the same review. */
  onCount?: (n: number) => void;
  /** Changing this number opens the review, for callers outside this button. */
  openSignal?: number;
  /**
   * Local rows for a fixture preview. Skips the server read. Production callers
   * leave this unset.
   */
  fixture?: { suggestions: Sug[]; conflicts?: Sug[]; possibleMatches?: any[]; needsVerification?: any[] };
}) {
  const load = useServerFn(getVehicleSuggestions);
  const apply = useServerFn(applyImportDecisions);
  const [data, setData] = useState<{ suggestions: Sug[]; conflicts: Sug[]; possibleMatches: any[]; needsVerification?: any[] } | null>(
    fixture
      ? { suggestions: fixture.suggestions, conflicts: fixture.conflicts ?? [], possibleMatches: fixture.possibleMatches ?? [], needsVerification: fixture.needsVerification ?? [] }
      : null,
  );
  const [open, setOpen] = useState(inline || !!fixture);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewFile, setViewFile] = useState<ViewFile | null>(null);
  const [viewPending, setViewPending] = useState(false);
  const openSeq = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const r: any = await load({ data: { vehicleId } });
      if (batchId) {
        const only = (xs: any[]) => (xs ?? []).filter((x) => x.batchId === batchId);
        setData({ ...r, suggestions: only(r.suggestions), conflicts: only(r.conflicts), possibleMatches: only(r.possibleMatches), needsVerification: only(r.needsVerification) });
      } else setData(r);
    } catch { setData(null); }
    // batchId belongs here: without it this callback kept the first batch it
    // was rendered with and filtered a later upload's details away. Masked
    // today by the caller re-keying the component, which is not a guarantee.
  }, [load, vehicleId, batchId]);
  useEffect(() => { if (fixture) return; void refresh(); }, [refresh, fixture]);
  useEffect(() => { if (inline) setOpen(true); }, [inline]);
  // Tell the caller how many are waiting, so the Readiness card can offer the
  // same review without fetching the list a second time.
  useEffect(() => { onCount?.(data?.suggestions?.length ?? 0); }, [data, onCount]);
  useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);

  const key = (s: Sug) => `${s.proposalId}:${s.field}`;
  const closeView = useCallback(() => { setViewing(null); setViewFile(null); setViewPending(false); }, []);
  const openSource = useCallback(async (s: SourceRef) => {
    const seq = ++openSeq.current;
    setViewFile(metaOf(s));
    setViewing(null);
    setViewPending(true);
    let url: string | null = null;
    try {
      if (s.resolvedUrl) url = s.resolvedUrl;
      else if (s.photoPath) url = await loadStaffPhoto(s.photoPath);
      else if (s.storageBucket && s.storagePath) url = await loadStaffVehicleDocUrl(s.storageBucket, s.storagePath);
    } catch {
      url = null;
    }
    if (seq !== openSeq.current) return;
    setViewing(url);
    setViewPending(false);
  }, []);
  const sugs = data?.suggestions ?? [];
  const safeKeys = useMemo(() => sugs.filter((s) => s.safe).map(key), [sugs]);
  const count = sugs.length;
  if (!data || (count === 0 && !data.possibleMatches.length && !data.conflicts.length && !(data.needsVerification ?? []).length)) {
    if (!inline || !data) return null;
    // Accepting the last field empties this list. Reporting "nothing to add"
    // in place of "Saved 5 Details" told staff their save had done nothing.
    if (msg) return <p className="text-[12px] text-[#111114]">{msg} Nothing further to review from this document.</p>;
    if (emptyText === null) return null;
    return (
      <p className="text-[12px] text-[#55555E]">
        {emptyText ?? "No new details to add — this vehicle already has every value the document shows."}
      </p>
    );
  }

  async function submit(keys: string[]) {
    if (!keys.length) return;
    setBusy(true); setMsg(null);
    try {
      const chosen = sugs.filter((s) => keys.includes(key(s)));
      const byBatch = new Map<string, Map<string, string[]>>();
      for (const s of chosen) {
        const b = byBatch.get(s.batchId) ?? new Map();
        const f = b.get(s.proposalId) ?? [];
        f.push(s.field);
        b.set(s.proposalId, f);
        byBatch.set(s.batchId, b);
      }
      let applied = 0;
      const errors: string[] = [];
      // Itemised by the server. This used to read the count back out of the
      // result SENTENCE with a regular expression, so a reworded message would
      // have reported every save as "nothing saved".
      const unchanged: string[] = [];
      const pending: string[] = [];
      const refused: Array<{ label: string; reason: string }> = [];
      for (const [batchId, props] of byBatch) {
        const res = await apply({
          data: {
            batchId,
            decisions: [...props].map(([proposalId, fields]) => ({
              proposalId,
              action: "match" as const,
              vehicleId,
              acceptFields: fields,
              confirmHighRisk: fields,
              applyFinance: false,
              partial: true,
            })),
          },
        });
        for (const r of res.results) {
          if (!r.ok) {
            errors.push(r.message);
            continue;
          }
          // The arrays are the contract. A response from a server that predates
          // them still must not be read as "nothing saved", so the old count in
          // the sentence is the fallback — never the primary.
          applied += Array.isArray(r.applied)
            ? r.applied.length
            : Number(/(\d+) change/.exec(r.message ?? "")?.[1] ?? 0);
          unchanged.push(...(r.unchanged ?? []));
          pending.push(...(r.needsConfirmation ?? []));
          refused.push(...(r.rejected ?? []));
        }
      }
      const pretty = (f: string) => titleCase(f);
      const parts: string[] = [];
      if (applied) parts.push(`Saved ${applied} Detail${applied === 1 ? "" : "s"}.`);
      if (unchanged.length)
        parts.push(`${unchanged.map(pretty).join(", ")} already matched the record.`);
      if (pending.length)
        parts.push(`${pending.map(pretty).join(", ")} still needs individual confirmation.`);
      for (const r of refused) parts.push(`${titleCase(r.label)} was not saved: ${r.reason}`);
      if (!parts.length) parts.push("Nothing Saved — Those Fields Already Have Values.");
      setMsg(errors.length ? errors.join(" ") : parts.join(" "));
      setPicked(new Set());
      await refresh();
      onApplied(errors.length ? 0 : applied);
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
                {s.photoPath && <EvidencePhoto path={s.photoPath} onOpen={setViewing} onPreview={() => { openSeq.current += 1; setViewPending(false); setViewFile(metaOf(s)); }} />}
                {!s.photoPath && (s.resolvedUrl || (s.storageBucket && s.storagePath)) && (
                  <SourceDocThumb
                    fileName={s.fileName}
                    mimeType={s.mimeType}
                    page={s.page}
                    storageBucket={s.storageBucket}
                    storagePath={s.storagePath}
                    presetUrl={s.resolvedUrl}
                    onOpen={(url) => { openSeq.current += 1; setViewPending(false); setViewFile(metaOf(s)); setViewing(url); }}
                  />
                )}
                {!s.photoPath && !(s.resolvedUrl || (s.storageBucket && s.storagePath)) && (
                  <span aria-hidden className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border border-[#EDEDF0] bg-[#F4F4F6] text-[#55555E]"><FileText className="h-5 w-5" /></span>
                )}
                <div className="min-w-0 flex-1 text-[12px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#111114]">{s.label.replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                    <span className={s.field === "body_type" ? "text-[#111114]" : "font-mono text-[#111114]"}>{s.field === "body_type" ? titleCase(s.proposed) : s.proposed}</span>
                    <span className="rounded-full bg-[#F2F2F4] px-2 py-0.5 text-[10px]">{titleCase(s.confidence)} Confidence</span>
                    {!s.safe && <span className="rounded-full bg-[#FFF4E5] px-2 py-0.5 text-[10px] text-[#8A4B00]">Confirm Individually</span>}
                    {s.fromPhoto && <span className="rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] text-[#3730A3]">Read From A Photo</span>}
                  </div>
                  <div className="text-[#55555E] mt-1">Current: {s.current ?? "Not Set"}</div>
                  <button type="button" data-testid="suggestion-source-file" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void openSource(s); }} className="mt-0.5 inline-flex max-w-full items-center gap-1 text-left text-[#55555E] hover:text-[#111114] hover:underline">
                    <FileText className="h-3 w-3 shrink-0" /> <span className="truncate">{sourceLine(s)}</span>
                  </button>
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
                {data.possibleMatches.map((m: any) => (
                  <div key={m.proposalId} className="mb-2 flex items-start gap-3 text-[#55555E]">
                    {m.photoPath ? (
                      <EvidencePhoto path={m.photoPath} onOpen={setViewing} onPreview={() => { openSeq.current += 1; setViewPending(false); setViewFile(metaOf(m)); }} />
                    ) : m.resolvedUrl || (m.storageBucket && m.storagePath) ? (
                      <SourceDocThumb
                        fileName={m.fileName}
                        mimeType={m.mimeType}
                        page={m.page}
                        storageBucket={m.storageBucket}
                        storagePath={m.storagePath}
                        presetUrl={m.resolvedUrl}
                        onOpen={(url) => { openSeq.current += 1; setViewPending(false); setViewFile(metaOf(m)); setViewing(url); }}
                      />
                    ) : (
                      <span aria-hidden className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border border-[#EDEDF0] bg-[#F4F4F6] text-[#55555E]"><FileText className="h-5 w-5" /></span>
                    )}
                    <div className="min-w-0">
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void openSource(m); }} className="inline-flex max-w-full items-center gap-1 text-left hover:text-[#111114] hover:underline">
                        <FileText className="h-3 w-3 shrink-0" /> <span className="truncate">{m.fileName}</span>
                      </button>
                      {m.reason ? <div>{m.reason}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {viewFile && (
              <SourceLightbox viewing={viewing} file={viewFile} pending={viewPending} onClose={closeView} />
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
