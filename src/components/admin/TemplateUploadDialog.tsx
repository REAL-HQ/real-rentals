import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileUploader } from "@/components/FileUploader";
import { AgreementPdfViewer } from "@/components/admin/AgreementPdfViewer";
import { previewTemplateBody, storeTemplateUpload } from "@/lib/agreement-templates.functions";
import { extractDocx, extractPdf, kindOf, MAX_TEMPLATE_BYTES, TEMPLATE_ACCEPT } from "@/lib/agreement-extract";
import { analyzeAgreement, applyMappings, wordingPreserved, TARGET_OPTIONS, targetId, type Analysis, type Detection, type Target } from "@/lib/agreement-import";
import { acknowledgmentsOf } from "@/lib/agreement-library";
import { writeTerms } from "@/lib/agreement-builder";

const sel = "h-8 w-full rounded-md border bg-background px-1.5 text-[12px]";

function TargetSelect({ value, onChange, label }: { value: Target; onChange: (t: Target) => void; label: string }) {
  const groups = [...new Set(TARGET_OPTIONS.map((o) => o.group))];
  return (
    <select aria-label={`Mapping For ${label}`} className={sel} value={targetId(value)} onChange={(e) => onChange(JSON.parse(e.target.value))}>
      {!TARGET_OPTIONS.some((o) => targetId(o.target) === targetId(value)) && <option value={targetId(value)}>Detected Value</option>}
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {TARGET_OPTIONS.filter((o) => o.group === g).map((o) => <option key={targetId(o.target)} value={targetId(o.target)}>{o.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Owner-only Smart Agreement Upload: original kept privately, mappings reviewed, previewed. Never approves. */
export function TemplateUploadDialog({ onClose }: { onClose: () => void }) {
  const storeFn = useServerFn(storeTemplateUpload);
  const previewFn = useServerFn(previewTemplateBody);
  const [file, setFile] = useState<{ name: string; path: string | null; sha: string | null } | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [dets, setDets] = useState<Detection[]>([]);
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [tab, setTab] = useState<"fields" | "wording" | "preview">("fields");
  const [selection, setSelection] = useState("");
  const wordingRef = useRef<HTMLTextAreaElement>(null);

  async function onFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    setBusy(true); setAnalysis(null); setPdf(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const kind = kindOf(f.name, bytes);
      if (!kind) throw new Error("Only PDF and Word (.docx) agreements can be uploaded.");
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const stored = await storeFn({ data: { fileName: f.name, base64: btoa(bin) } });
      if (!stored.ok) throw new Error(stored.error);
      const ex = kind === "pdf" ? await extractPdf(bytes) : await extractDocx(bytes);
      const a = analyzeAgreement(ex);
      setFile({ name: f.name, path: stored.path, sha: stored.sha256 });
      setAnalysis(a); setDets(a.detections);
    } catch (e: any) { toast.error(e?.message ?? "Could not read the agreement"); } finally { setBusy(false); }
  }

  const applied = useMemo(() => (analysis ? applyMappings(analysis.raw, dets) : null), [analysis, dets]);
  const body = useMemo(() => (applied ? writeTerms(applied.source, applied.terms) : ""), [applied]);
  const preserved = analysis && applied ? wordingPreserved(analysis.raw, applied.source) : true;
  const acks = body ? acknowledgmentsOf(body).length : 0;

  useEffect(() => {
    if (!body) return;
    let stale = false;
    const t = setTimeout(async () => {
      setRendering(true);
      try { const r = await previewFn({ data: { body, label: `Uploaded Draft — ${file?.name ?? ""}`.slice(0, 80) } }); if (!stale) setPdf(r.pdfBase64); }
      catch (e: any) { if (!stale) toast.error(e?.message ?? "Preview failed"); } finally { if (!stale) setRendering(false); }
    }, 700);
    return () => { stale = true; clearTimeout(t); };
  }, [body, previewFn, file?.name]);

  const setTarget = (id: string, target: Target) => setDets((ds) => ds.map((d) => (d.id === id ? { ...d, target, source: "Owner" } : d)));
  function mapSelection() {
    const text = selection;
    if (!text.trim() || !analysis) return;
    if (!analysis.raw.includes(text)) return void toast.error("Select text exactly as it appears in the wording.");
    if (/\n/.test(text) || text.length > 60) return void toast.error("Select a short placeholder (one line, up to 60 characters).");
    setDets((ds) => [...ds, { id: `o${Date.now()}`, category: "Unmapped", label: `"${text}"`, where: { kind: "inline", text }, original: text, target: { t: "none" }, confidence: "High", source: "Owner" }]);
    setTab("fields");
  }

  const blockers = [
    ...(applied?.problems ?? []),
    ...(!preserved ? ["The legal wording would change. Mappings may only fill blanks and placeholders."] : []),
    ...(analysis && !analysis.signatureBlock ? ["No signature section was found."] : []),
    ...(analysis?.needsManualReview ? ["The file needs manual review (scanned or partly unreadable)."] : []),
  ];

  const fields = analysis && (
    <div className="space-y-3 p-3 text-[12px]">
      <div className="rounded-md border bg-card p-2.5 space-y-0.5">
        <p className="font-medium break-all">{file?.name}</p>
        <p className="text-muted-foreground">Original kept privately{file?.sha ? ` · SHA-256 ${file.sha.slice(0, 12)}…` : ""}</p>
        <p>{acks} acknowledgment(s) to initial · Signature block {analysis.signatureBlock ? "found" : "missing"} · {(analysis.coverage * 100).toFixed(1)}% of text carried over</p>
      </div>
      {analysis.warnings.map((w, i) => <p key={i} className="flex gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</p>)}
      {blockers.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-destructive" data-testid="upload-blockers">
          <p className="font-semibold">Before this can become a draft:</p>
          {blockers.map((b, i) => <p key={i}>- {b}</p>)}
        </div>
      )}
      <div className="space-y-1.5" data-testid="mapping-table">
        {dets.map((d) => (
          <div key={d.id} className="grid grid-cols-1 gap-1 rounded-md border bg-card p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
            <div className="min-w-0">
              <p className="truncate font-medium" title={d.label}>{d.label}</p>
              <p className="text-[11px] text-muted-foreground">{d.category} · {d.where.kind === "row" ? "Table Row" : "In Text"} · {d.source === "Owner" ? "Owner Set" : `${d.confidence} Confidence`}</p>
            </div>
            <TargetSelect value={d.target} label={d.label} onChange={(t) => setTarget(d.id, t)} />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Mappings only fill blank table values and placeholders such as [Legal Entity Name]; the legal wording is never rewritten. Reusable values such as [24] stay exactly as written unless you map them to a contract setting.</p>
    </div>
  );

  const wording = analysis && (
    <div className="flex h-full flex-col gap-2 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Select a placeholder in the wording to place a field by hand.</span>
        <Button size="sm" variant="outline" disabled={!selection.trim()} onClick={mapSelection}><Plus className="h-3.5 w-3.5" /> Map Selection</Button>
      </div>
      <textarea ref={wordingRef} readOnly aria-label="Converted Wording" value={analysis.raw}
        onSelect={(e) => { const el = e.currentTarget; setSelection(el.value.slice(el.selectionStart, el.selectionEnd)); }}
        className="min-h-[50vh] flex-1 rounded-md border bg-background p-2 font-mono text-[11px] leading-5" />
    </div>
  );

  const preview = (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2 text-[12px]">
        <span className="rounded bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">PREVIEW — SAMPLE FIELDS</span>
        {rendering && <span className="text-muted-foreground">Updating…</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/40" data-testid="upload-preview">
        {pdf ? <AgreementPdfViewer key={body.length + (pdf?.length ?? 0)} base64={pdf} /> : <p className="p-6 text-muted-foreground">{analysis ? "Building preview…" : "Upload an agreement to see it here."}</p>}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background" role="dialog" aria-label="Upload Agreement Template">
      <header className="flex shrink-0 flex-col gap-2 border-b bg-card px-3 py-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}><ArrowLeft className="h-4 w-4" /> Back</Button>
          <span className="truncate text-[14px] font-semibold">Upload Agreement Template</span>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px]">Draft — Legal Review Required</span>
          <Button size="sm" disabled title="Saving uploaded drafts needs the template database update (pending migration after Codex 0022).">Save As Draft</Button>
        </div>
      </header>
      {!analysis ? (
        <div className="mx-auto w-full max-w-xl space-y-3 p-4">
          <FileUploader variant="zone" accept={TEMPLATE_ACCEPT} maxBytes={MAX_TEMPLATE_BYTES} multiple={false} onFiles={onFiles}
            label={busy ? "Reading Agreement…" : "Drop A PDF Or Word Agreement"} hint="PDF or .docx, up to 10 MB. The original is kept privately and is never sent." />
          <p className="text-[12px] text-muted-foreground">The agreement is read for its text, tables, fields, initials and signature lines. Scanned or image-only files are flagged for manual review — nothing is guessed. Uploaded agreements are never approved or used automatically.</p>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 border-b lg:hidden" role="tablist">
            {(["fields", "wording", "preview"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 py-2 text-[13px] ${tab === t ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>{t === "fields" ? "Fields" : t === "wording" ? "Wording" : "Preview"}</button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1">
            <aside className={`${tab === "preview" ? "hidden" : "flex"} w-full flex-col overflow-y-auto bg-muted/20 lg:flex lg:w-[40%] lg:border-r`}>
              <div className="hidden border-b lg:flex" role="tablist">
                {(["fields", "wording"] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 py-2 text-[13px] ${tab === t || (t === "fields" && tab === "preview") ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>{t === "fields" ? "Fields" : "Wording"}</button>
                ))}
              </div>
              {tab === "wording" ? wording : fields}
            </aside>
            <section className={`${tab === "preview" ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}>{preview}</section>
          </div>
        </>
      )}
    </div>
  );
}

export default TemplateUploadDialog;
