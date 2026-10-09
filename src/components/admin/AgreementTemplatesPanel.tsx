import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AgreementPdfViewer } from "@/components/admin/AgreementPdfViewer";
import { fmtDate, fmtDateTime } from "@/lib/date-format";
import {
  listTemplateVersions, saveTemplateDraft, previewTemplateVersion, approveTemplateVersion, retireTemplateVersion, setTemplateEnforcement,
  unknownFieldsIn, type TemplateVersion,
} from "@/lib/agreement-templates.functions";

type Data = Awaited<ReturnType<typeof listTemplateVersions>>;

/** Line diff (LCS) — enough for contract-length text. */
function diffLines(a: string, b: string) {
  const A = a.split("\n"), B = b.split("\n");
  const dp = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: " " | "-" | "+"; s: string }[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ t: " ", s: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "-", s: A[i++] });
    else out.push({ t: "+", s: B[j++] });
  }
  while (i < A.length) out.push({ t: "-", s: A[i++] });
  while (j < B.length) out.push({ t: "+", s: B[j++] });
  return out;
}

function Diff({ from, to }: { from: string; to: string }) {
  const rows = useMemo(() => diffLines(from, to), [from, to]);
  const changes = rows.filter((r) => r.t !== " ").length;
  return (
    <div>
      <p className="text-[12px] text-muted-foreground mb-2">{changes ? `${changes} changed line(s)` : "No differences"}</p>
      <pre className="max-h-[50vh] overflow-auto rounded-lg border bg-muted/30 p-3 text-[12px] leading-5 whitespace-pre-wrap">
        {rows.map((r, k) => (
          <div key={k} className={r.t === "+" ? "bg-success/15 text-foreground" : r.t === "-" ? "bg-destructive/10 text-destructive line-through" : "text-muted-foreground"}>
            {r.t === " " ? "  " : r.t + " "}{r.s || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

const statusLabel = (v: TemplateVersion) => (v.status === "approved" ? "Approved" : v.status === "retired" ? "Retired" : "Draft — Legal Review Required");

export function AgreementTemplatesPanel() {
  const listFn = useServerFn(listTemplateVersions);
  const saveFn = useServerFn(saveTemplateDraft);
  const previewFn = useServerFn(previewTemplateVersion);
  const approveFn = useServerFn(approveTemplateVersion);
  const retireFn = useServerFn(retireTemplateVersion);
  const enforceFn = useServerFn(setTemplateEnforcement);
  const [enfMode, setEnfMode] = useState<null | "on" | "off">(null);
  const [enfText, setEnfText] = useState("");
  const [enfReason, setEnfReason] = useState("");
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [mode, setMode] = useState<null | "preview" | "edit" | "compare" | "approve" | "retire">(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [cmp, setCmp] = useState<number | null>(null);
  const [eff, setEff] = useState("");
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listFn().then((r) => { setD(r); setSel((s) => s ?? r.versions[0]?.version ?? null); }).catch(() => setErr("Only the Owner can manage agreement templates."));
  }, [listFn]);
  useEffect(load, [load]);

  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!d) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const v = d.versions.find((x) => x.version === sel) ?? d.versions[0];
  const other = d.versions.find((x) => x.version === cmp);
  const dbNote = !d.versioningActive;
  const draftUnknown = unknownFieldsIn(draft);

  async function openPreview() {
    setMode("preview"); setPdf(null);
    const r = await previewFn({ data: { version: v.version } });
    if (r.ok) setPdf(r.pdfBase64); else toast.error(r.error);
  }
  async function saveDraft() {
    setBusy(true);
    try {
      const r = await saveFn({ data: { body: draft, basedOn: v.version } });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Draft v${r.version} Saved`); setMode(null); setSel(r.version); load();
    } finally { setBusy(false); }
  }
  async function approve() {
    setBusy(true);
    try {
      const r = await approveFn({ data: { version: v.version, fingerprint: v.fingerprint, effectiveDate: eff, confirm: "APPROVE" } });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Version Approved"); setMode(null); load();
    } finally { setBusy(false); }
  }
  async function setEnforcement(enabled: boolean) {
    setBusy(true);
    try {
      const r = await enforceFn({ data: { enabled, reason: enfReason, confirm: enabled ? "ENABLE" : "DISABLE" } });
      if (!r.ok) return void toast.error(r.error);
      toast.success(enabled ? "Enforcement On" : "Enforcement Off"); setEnfMode(null); setEnfText(""); setEnfReason(""); load();
    } catch (e: any) { toast.error(e?.message || "Could not change enforcement"); } finally { setBusy(false); }
  }
  async function retire() {
    setBusy(true);
    try {
      const r = await retireFn({ data: { version: v.version, reason } });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Version Retired"); setMode(null); load();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 text-[13px] space-y-1">
        <p><span className="text-muted-foreground">Used For Sending:</span> <span className="font-medium">{d.inUseLabel}</span></p>
        <p className="text-muted-foreground">Saving an edit creates a new Draft. Drafts never change what drivers receive. Owner approval is a business sign-off, not a legal review.</p>
        {dbNote && <p className="text-warning-foreground bg-warning/15 rounded-md px-2 py-1">Approve, Retire and Effective Date are available after the template database update is approved and applied. Until then, sending keeps using Draft v1 exactly as today.</p>}
      </div>


      <div className="rounded-xl border bg-card p-4 text-[13px] space-y-2" data-testid="enforcement-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Approved-Template Enforcement: <span className={d.enforcementSwitch ? "text-success" : "text-muted-foreground"}>{d.enforcementSwitch ? "On" : "Off"}</span></p>
          {!enfMode && (d.enforcementSwitch
            ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setEnfMode("off")}>Turn Off</Button>
            : <Button size="sm" disabled={busy || !d.versioningActive || !d.versions.some((x) => x.status === "approved")} onClick={() => setEnfMode("on")}>Turn On</Button>)}
        </div>
        <p className="text-muted-foreground">{d.enforcementSwitch
          ? "Only an Owner-approved template can be sent. Turning this off does not change existing agreements."
          : !d.versioningActive ? "Off. Available after the template database update is applied. Sending works exactly as today."
          : !d.versions.some((x) => x.status === "approved") ? "Off. Approve a template version first — turning this on without one would block all sending."
          : "Off. Sending still uses the current template. Turn on to require the approved version."}</p>
        {enfMode && (
          <div className="space-y-2 rounded-md border p-3">
            <p>{enfMode === "on" ? "Type ENABLE to require the approved template for every new agreement." : "Type DISABLE and give a reason. Sending returns to the current template."}</p>
            {enfMode === "off" && <Textarea value={enfReason} onChange={(e) => setEnfReason(e.target.value)} placeholder="Reason" rows={2} />}
            <input className="w-full rounded-md border px-2 py-1" value={enfText} onChange={(e) => setEnfText(e.target.value)} placeholder={enfMode === "on" ? "ENABLE" : "DISABLE"} aria-label="Confirmation" />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || enfText !== (enfMode === "on" ? "ENABLE" : "DISABLE") || (enfMode === "off" && enfReason.trim().length < 3)} onClick={() => setEnforcement(enfMode === "on")}>Confirm</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEnfMode(null); setEnfText(""); setEnfReason(""); }}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {d.issues.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-[13px]">
          <p className="font-medium text-destructive mb-1">Company Details To Fix Before Approval</p>
          <ul className="list-disc pl-5 space-y-0.5">{d.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b text-[13px] font-medium">Versions</div>
        <ul className="divide-y">
          {d.versions.map((x) => (
            <li key={x.version}>
              <button type="button" onClick={() => setSel(x.version)}
                className={`w-full text-left px-4 py-3 grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-1 text-[13px] ${x.version === v.version ? "bg-muted/50" : "hover:bg-muted/30"}`}>
                <span className="font-medium">v{x.version}{x.inUse && <span className="ml-2 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px]">In Use</span>}</span>
                <span>{statusLabel(x)}</span>
                <span className="text-muted-foreground">Effective: {x.effectiveDate ? fmtDate(x.effectiveDate) : "Not Set"}</span>
                <span className="text-muted-foreground">Created: {x.createdAt ? fmtDate(x.createdAt) : "Built In"}</span>
                <span className="text-muted-foreground font-mono text-[11px] truncate" title={x.fingerprint}>{x.fingerprint.slice(0, 16)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{v.name} — v{v.version}</p>
            <p className="text-[12px] text-muted-foreground">
              {statusLabel(v)} · Approved: {v.approvedAt ? `${fmtDateTime(v.approvedAt)}` : "Not Approved"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={openPreview}>Preview</Button>
            <Button size="sm" variant="outline" onClick={() => { setDraft(v.body); setMode("edit"); }}>Edit Draft</Button>
            <Button size="sm" variant="outline" disabled={d.versions.length < 2} onClick={() => { setCmp(d.versions.find((x) => x.version !== v.version)?.version ?? null); setMode("compare"); }}>Compare</Button>
            <Button size="sm" disabled={dbNote || v.status !== "draft" || !v.id} title={dbNote ? "Needs Database Update" : undefined} onClick={() => { setTyped(""); setEff(""); setCmp(d.versions.find((x) => x.status === "approved")?.version ?? d.versions.find((x) => x.version !== v.version)?.version ?? null); setMode("approve"); }}>Approve</Button>
            <Button size="sm" variant="outline" disabled={dbNote || v.status === "retired" || !v.id} title={dbNote ? "Needs Database Update" : undefined} onClick={() => { setReason(""); setMode("retire"); }}>Retire</Button>
          </div>
        </div>
        {v.unknownFields.length > 0 && <p className="text-[13px] text-destructive">Unknown fields: {v.unknownFields.map((f) => `{{${f}}}`).join(", ")}</p>}
        <pre className="max-h-[40vh] overflow-auto rounded-lg border bg-muted/30 p-3 text-[12px] leading-5 whitespace-pre-wrap">{v.body}</pre>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <p className="font-medium text-[13px] mb-2">Supported Fields</p>
          <ul className="text-[12px] space-y-1">
            {d.fields.map((f) => (
              <li key={f.key} className="flex justify-between gap-2">
                <code className="text-muted-foreground">{`{{${f.key}}}`}</code>
                <span className="text-right">{f.label}{!v.body.includes(`{{${f.key}}}`) && <span className="text-muted-foreground"> · Not Used</span>}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="font-medium text-[13px] mb-2">Approval History</p>
          {d.history.length === 0 ? <p className="text-[12px] text-muted-foreground">No template changes recorded yet.</p> : (
            <ul className="text-[12px] space-y-2">
              {d.history.map((h, k) => (
                <li key={k}><span className="text-muted-foreground">{fmtDateTime(h.created_at)}</span> — {h.summary}{h.actor_email ? ` · ${h.actor_email}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {mode === "preview" && (<>
            <DialogHeader><DialogTitle>Preview v{v.version}</DialogTitle><DialogDescription>Full document with sample field labels. Nothing is sent.</DialogDescription></DialogHeader>
            {pdf ? <AgreementPdfViewer base64={pdf} /> : <p className="text-sm text-muted-foreground">Rendering…</p>}
          </>)}
          {mode === "edit" && (<>
            <DialogHeader><DialogTitle>Edit Draft</DialogTitle><DialogDescription>Saves as a new Draft based on v{v.version}. The original version is never changed.</DialogDescription></DialogHeader>
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[50vh] font-mono text-[12px]" />
            {draftUnknown.length > 0 && <p className="text-[13px] text-destructive">Unknown fields: {draftUnknown.map((f) => `{{${f}}}`).join(", ")}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
              <Button disabled={busy || draft === v.body || draftUnknown.length > 0} onClick={saveDraft}>{busy ? "Saving…" : "Create Version"}</Button>
            </DialogFooter>
          </>)}
          {(mode === "compare" || mode === "approve") && (<>
            <DialogHeader>
              <DialogTitle>{mode === "approve" ? `Approve v${v.version}` : "Compare Versions"}</DialogTitle>
              <DialogDescription>{mode === "approve" ? "Review every change below. Approval records your business sign-off; it does not mean the wording was legally reviewed." : `Changes from the chosen version to v${v.version}.`}</DialogDescription>
            </DialogHeader>
            <label className="text-[13px] flex items-center gap-2">Compare With
              <select className="h-9 rounded-md border bg-background px-2" value={cmp ?? ""} onChange={(e) => setCmp(Number(e.target.value))}>
                {d.versions.filter((x) => x.version !== v.version).map((x) => <option key={x.version} value={x.version}>v{x.version} — {statusLabel(x)}</option>)}
              </select>
            </label>
            {other && <Diff from={other.body} to={v.body} />}
            {mode === "approve" && (<div className="space-y-3">
              <Button size="sm" variant="outline" onClick={openPreview}>View Full Document</Button>
              <label className="block text-[13px]">Effective Date<Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></label>
              <label className="block text-[13px]">Type APPROVE to confirm<Input value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
                <Button disabled={busy || typed !== "APPROVE" || !eff || d.issues.length > 0 || v.unknownFields.length > 0} onClick={approve}>Approve</Button>
              </DialogFooter>
            </div>)}
          </>)}
          {mode === "retire" && (<>
            <DialogHeader><DialogTitle>Retire v{v.version}</DialogTitle><DialogDescription>Retired versions stay on record and cannot be used for new agreements. Sent and signed agreements are unaffected.</DialogDescription></DialogHeader>
            <label className="block text-[13px]">Reason<Input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
              <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={retire}>Retire</Button>
            </DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
