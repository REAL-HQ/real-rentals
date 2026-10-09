import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, Maximize2, Minus, Plus } from "lucide-react";
import { ServiceAreaField, MileageField } from "@/components/admin/ServiceAreaField";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AgreementPdfViewer } from "@/components/admin/AgreementPdfViewer";
import { previewTemplateBody, saveTemplateDraft, unknownFieldsIn, type TemplateVersion } from "@/lib/agreement-templates.functions";
import {
  TERM_FIELDS, ALL_TERM_FIELDS, TERM_GROUPS, V16_SOURCE, V16_TERM_DEFAULTS, readTerms, stripTerms, writeTerms, missingTerms, unknownTermsIn, termsIn,
} from "@/lib/agreement-builder";

/** Library templates: fixed legal wording; only contract values are edited and saved as a Draft. */
export type LibraryEdit = {
  key: string; name: string; versionLabel: string; source: string; terms: Record<string, string>;
  save: (terms: Record<string, string>) => Promise<{ ok: boolean; error?: string; version?: number }>;
};
const isOpen = (v?: string) => /\[[^\]]*\]/.test(String(v ?? ""));
const FIX_LINK: Record<string, string> = {
  "Legal Business Name": "/admin?tab=settings&section=company", "Business Address": "/admin?tab=settings&section=company",
  "Support Phone": "/admin?tab=settings&section=company", "Support Email": "/admin?tab=settings&section=company",
  "Countersigner": "/admin?tab=settings&section=esign",
};
import { Diff } from "@/components/admin/AgreementTemplatesPanel";

type Company = Record<string, any>;

function Section({ title, badge, children, open = false }: { title: string; badge?: number; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[13px] font-medium">
        <span className="min-w-0 truncate">{title}</span>
        <span className="flex shrink-0 items-center gap-2">
          {badge ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">{badge} Missing</span> : null}
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-3 border-t px-3 py-3">{children}</div>
    </details>
  );
}

export function AgreementBuilder({
  base, company, issues, onClose, onSaved, onApprove, library,
}: {
  library?: LibraryEdit;
  base: TemplateVersion;
  company: Company;
  issues: string[];
  onClose: () => void;
  onSaved: (version: number) => void;
  onApprove: () => void;
}) {
  const previewFn = useServerFn(previewTemplateBody);
  const saveFn = useServerFn(saveTemplateDraft);
  const baseTerms = library ? library.terms : readTerms(base.body);
  const startsFromV16 = !library && !baseTerms;
  const [source, setSource] = useState(() => (library ? library.source : baseTerms ? stripTerms(base.body) : V16_SOURCE));
  const [terms, setTerms] = useState<Record<string, string>>(() => (library ? { ...library.terms } : { ...V16_TERM_DEFAULTS, ...(baseTerms ?? {}) }));
  const usedTerms = useMemo(() => new Set(termsIn(source)), [source]);
  // Reservation Fee is rental-specific (Prepare Agreement), never a template value.
  const fieldList = library ? ALL_TERM_FIELDS.filter((f) => usedTerms.has(f.key) && f.key !== "reservation_line") : TERM_FIELDS;
  const hasMileage = usedTerms.has("mileage_allowance");
  const openValues = fieldList.filter((f) => isOpen(terms[f.key])).map((f) => f.key);
  const [tab, setTab] = useState<"details" | "preview">("details");
  const [pdf, setPdf] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const previewHost = useRef<HTMLDivElement>(null);

  const body = useMemo(() => writeTerms(source, terms), [source, terms]);
  const dirty = body !== base.body;
  const missing = useMemo(() => missingTerms(terms, source).filter((k) => !library || k !== "reservation_line"), [terms, source, library]);
  const unknown = useMemo(() => [...unknownFieldsIn(source).map((f) => `{{${f}}}`), ...unknownTermsIn(source).map((f) => `[[${f}]]`)], [source]);
  const canApprove = !library && !dirty && base.status === "draft" && !!base.id;

  // Live preview through the canonical PDF pipeline, debounced.
  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      setRendering(true);
      try {
        const r = await previewFn({ data: { body, label: dirty ? `Unsaved Draft (from v${base.version})` : `v${base.version}` } });
        if (!stale && r.ok) setPdf(r.pdfBase64);
      } catch (e: any) {
        if (!stale) toast.error(e?.message ?? "Preview failed");
      } finally {
        if (!stale) setRendering(false);
      }
    }, 700);
    return () => { stale = true; clearTimeout(t); };
  }, [body, dirty, base.version, previewFn]);

  async function save() {
    setBusy(true);
    try {
      const r: any = library ? await library.save(terms) : await saveFn({ data: { body, basedOn: base.version } });
      if (!r.ok) return void toast.error(r.error);
      toast.success(library ? `Draft Saved — Not Approved Or Active` : `Draft v${r.version} Saved — Not Active`);
      onSaved(r.version ?? base.version);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the draft.");
    } finally { setBusy(false); }
  }

  function goToPage(n: number) {
    const c = previewHost.current?.querySelectorAll("canvas")[n - 1];
    c?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const pageCount = () => previewHost.current?.querySelectorAll("canvas").length ?? 0;

  const set = (k: string, v: string) => setTerms((t) => ({ ...t, [k]: v }));
  const companyRows: [string, any][] = [
    ["Legal Business Name", company.company_name],
    ["Business Address", company.company_address],
    ["Support Phone", company.company_phone],
    ["Support Email", company.company_email],
    ["Countersigner", [company.signer_name, company.signer_title].filter(Boolean).join(", ")],
  ];

  const details = (
    <div className="space-y-3 p-3 sm:p-4">
      {startsFromV16 && (
        <p className="rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
          Starting from Vehicle Rental Agreement v1.6 (No Insurance). Saving creates a new Draft; v{base.version} is not changed.
        </p>
      )}
      {openValues.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px]" data-testid="open-values">
          <p className="font-semibold">Bracketed open values ({openValues.length}) — approval stays blocked until each is resolved or confirmed by legal review:</p>
          {openValues.map((k) => <p key={k}>- {ALL_TERM_FIELDS.find((f) => f.key === k)?.label}: {terms[k]} <button className="ml-1 font-semibold underline" onClick={() => { const el = document.getElementById(`term-${k}`); el?.closest("details")?.setAttribute("open", ""); setTimeout(() => { el?.scrollIntoView({ block: "center" }); el?.focus(); }, 50); }}>Edit</button></p>)}
        </div>
      )}
      {(missing.length > 0 || unknown.length > 0 || issues.length > 0) && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive space-y-0.5">
          {issues.map((i) => <p key={i}>{i}</p>)}
          {missing.length > 0 && <p>Missing values: {missing.map((k) => ALL_TERM_FIELDS.find((f) => f.key === k)?.label ?? k).join(", ")}</p>}
          {unknown.length > 0 && <p>Unknown fields: {unknown.join(", ")}</p>}
        </div>
      )}

      <Section title="Company" badge={issues.length} open>
        <dl className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
          {companyRows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              {(() => { const unset = !v || issues.some((i) => i.startsWith(k === "Business Address" ? "Mailing Address" : k)); return (
                <dd className={`min-w-0 break-words ${unset ? "text-destructive" : ""}`}>{unset ? (v ? `Not Set (fallback "${v}" would print)` : "Not Set") : v}
                  {unset && FIX_LINK[k] && <a className="ml-1.5 font-semibold underline" href={FIX_LINK[k]} target="_blank" rel="noreferrer">Fix</a>}</dd>); })()}
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-muted-foreground">Company details come from Settings → Company and Agreements & eSign. Edit them there.</p>
      </Section>

      {TERM_GROUPS.map((g) => {
        const fields = fieldList.filter((f) => f.group === g);
        if (!fields.length) return null;
        const miss = fields.filter((f) => missing.includes(f.key) || openValues.includes(f.key)).length;
        return (
          <Section key={g} title={g} badge={miss}>
            {g === "Pricing & Deposit" && (
              <p className="text-[11px] text-muted-foreground">Weekly rate and deposit amount come from each vehicle and rental when an agreement is prepared.</p>
            )}
            {fields.map((f) => (
              <label key={f.key} className="block text-[12px]">
                <span className="mb-1 block font-medium">{f.label}{isOpen(terms[f.key]) && <span className="ml-1.5 rounded bg-warning/15 px-1.5 text-[10.5px] font-normal">Open Value</span>}</span>
                {f.key === "mileage_allowance" ? (
                  <MileageField value={terms.mileage_allowance ?? ""} fee={terms.excess_mileage_fee ?? ""} onChange={(v) => set("mileage_allowance", v)} onFee={(v) => set("excess_mileage_fee", v)} missing={missing.includes(f.key)} />
                ) : f.key === "service_area" ? (
                  <ServiceAreaField value={terms[f.key] ?? ""} onChange={(v) => set(f.key, v)} missing={missing.includes(f.key)} />
                ) : f.multiline ? (
                  <Textarea id={`term-${f.key}`} rows={3} value={terms[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}
                    className={`text-[12px] ${missing.includes(f.key) ? "border-destructive" : ""}`} />
                ) : (
                  <input id={`term-${f.key}`} value={terms[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}
                    className={`h-8 w-full rounded-md border bg-background px-2 text-[12px] ${missing.includes(f.key) ? "border-destructive" : ""}`} />
                )}
              </label>
            ))}
          </Section>
        );
      })}

      <Section title="Legal Wording">
        <p className="text-[11px] text-muted-foreground">
          The full contract text. {"{{field}}"} values are filled per rental; [[term]] values come from the sections above. Any change saves as a new Draft.
        </p>
        {library && <p className="text-[11px] text-muted-foreground">This agreement's legal wording is fixed; only the contract values above can change.</p>}
        <Textarea readOnly={!!library} value={source} onChange={(e) => setSource(e.target.value)} className="min-h-[60vh] font-mono text-[11px] leading-5" aria-label="Legal Wording" />
      </Section>
    </div>
  );

  const preview = (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2 text-[12px]">
        <span className="rounded bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">PREVIEW — NOT SENT</span>
        {rendering && <span className="text-muted-foreground">Updating…</span>}
        <span className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Zoom Out" onClick={() => setZoom((z) => Math.max(50, z - 10))}><Minus className="h-3.5 w-3.5" /></Button>
          <span className="w-10 text-center tabular-nums">{zoom}%</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Zoom In" onClick={() => setZoom((z) => Math.min(200, z + 10))}><Plus className="h-3.5 w-3.5" /></Button>
          <select aria-label="Go To Page" className="h-7 rounded border bg-background px-1" value="" onChange={(e) => goToPage(Number(e.target.value))}
            onFocus={(e) => { const n = pageCount(); e.currentTarget.innerHTML = `<option value="">Page</option>` + Array.from({ length: n }, (_, i) => `<option value="${i + 1}">Page ${i + 1}</option>`).join(""); }}>
            <option value="">Page</option>
          </select>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Full Screen" onClick={() => previewHost.current?.requestFullscreen?.()}><Maximize2 className="h-3.5 w-3.5" /></Button>
        </span>
      </div>
      <div ref={previewHost} className="min-h-0 flex-1 overflow-auto bg-muted/40" data-testid="builder-preview">
        <div style={{ width: `${zoom}%`, minWidth: 320 }} className="mx-auto">
          {pdf ? <AgreementPdfViewer key={`${zoom}-${pdf.length}-${pdf.slice(-32)}`} base64={pdf} /> : <p className="p-6 text-[12px] text-muted-foreground">Rendering preview…</p>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background" role="dialog" aria-label="Agreement Builder">
      <header className="flex shrink-0 flex-col gap-2 border-b bg-card px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => { if (!dirty || confirm("Discard unsaved changes?")) onClose(); }}><ArrowLeft className="h-4 w-4" /> Back</Button>
          <span className="truncate text-[14px] font-semibold">{library ? library.name : base.name}</span>
          <span className="shrink-0 text-[12px] text-muted-foreground">{library ? library.versionLabel : dirty ? `New Draft (from v${base.version})` : `v${base.version}`}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${base.status === "approved" && !dirty ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
            {dirty ? "Unsaved" : base.status === "approved" ? "Approved" : base.status === "retired" ? "Retired" : "Draft"}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ml-auto">
          <Button size="sm" variant="outline" onClick={() => setCompare((c) => !c)}>{compare ? "Hide Compare" : "Compare"}</Button>
          <Button size="sm" variant="outline" disabled={busy || !dirty || unknown.length > 0} onClick={save}>{busy ? "Saving…" : "Save Draft"}</Button>
          <Button size="sm" disabled={!canApprove} title={canApprove ? undefined : "Save this as a Draft first, then approve it"} onClick={onApprove}>Approve Version</Button>
        </div>
      </header>

      {compare && (
        <div className="max-h-[35vh] shrink-0 overflow-auto border-b bg-card p-3">
          <p className="mb-1 text-[12px] font-medium">Changes From v{base.version}</p>
          <Diff from={base.body} to={body} />
        </div>
      )}

      <div className="flex shrink-0 border-b md:hidden" role="tablist">
        {(["details", "preview"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[13px] ${tab === t ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>
            {t === "details" ? "Details" : "Preview"}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className={`${tab === "details" ? "block" : "hidden"} w-full overflow-y-auto bg-muted/20 md:block md:w-[35%] md:border-r`} data-testid="builder-details">
          {details}
        </aside>
        <section className={`${tab === "preview" ? "flex" : "hidden"} min-w-0 flex-1 flex-col md:flex`}>
          {preview}
        </section>
      </div>
    </div>
  );
}

export default AgreementBuilder;
