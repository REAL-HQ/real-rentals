import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listPartnerSubmissions,
  getSubmissionDocumentUrl,
  approvePartnerSubmission,
  declinePartnerSubmission,
  recordPartnerPayout,
  attachPayoutReceipt,
  type StaffSubmission,
} from "@/lib/partner-admin.functions";
import { PARTNER_DOCS_BUCKET } from "@/lib/partner-portal";
import { EmptyState } from "./ui";
import { FileUploader } from "@/components/FileUploader";
import { AppSelect } from "@/components/ui/app-select";

/**
 * Back Office -> Partners -> Vehicle Submissions. Every /partners submission
 * (and every car a signed-in partner adds), with photos, registration and ID,
 * and the one-button decision: "List This Car" activates the partner, creates
 * the vehicle at the rate you type, and publishes the photos you tick.
 */
export function PartnerSubmissions({ onChanged }: { onChanged?: () => void }) {
  const list = useServerFn(listPartnerSubmissions);
  const q = useQuery({ queryKey: ["admin", "partner-submissions"], queryFn: () => list() });
  const [filter, setFilter] = useState<"open" | "approved" | "declined" | "all">("open");
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading submissions…</p>;
  if (q.error || !q.data) return <p className="text-sm text-real-red">{(q.error as Error)?.message ?? "Could not load submissions."}</p>;
  const rows = q.data.submissions.filter((s) => {
    const st = s.status.toLowerCase();
    if (filter === "all") return true;
    if (filter === "approved") return st === "approved" || st === "enrolled";
    if (filter === "declined") return st === "declined";
    return !["approved", "enrolled", "declined"].includes(st);
  });
  return (
    <div data-testid="partner-submissions">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold tracking-wider text-muted-foreground mr-2">Vehicle Submissions</h3>
        {(["open", "approved", "declined", "all"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`px-3 py-1 rounded-md text-xs ${filter === f ? "bg-black text-white" : "bg-white border border-border"}`}>
            {f === "open" ? "Needs Review" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
        {q.data.schema === "legacy" && <span className="text-[11px] text-amber-700">Partner Portal database update not installed — listing is unavailable until it is.</span>}
      </div>
      <div className="space-y-3">
        {rows.map((s) => <SubmissionCard key={s.id} s={s} legacy={q.data!.schema === "legacy"} onChanged={() => { void q.refetch(); onChanged?.(); }} />)}
        {rows.length === 0 && <EmptyState title="Nothing Here" hint="New submissions from drivereal.com/partners appear here." />}
      </div>
    </div>
  );
}

function SubmissionCard({ s, legacy, onChanged }: { s: StaffSubmission; legacy: boolean; onChanged: () => void }) {
  const docUrl = useServerFn(getSubmissionDocumentUrl);
  const decline = useServerFn(declinePartnerSubmission);
  const [listing, setListing] = useState(false);
  const open = !["approved", "enrolled", "declined"].includes(s.status.toLowerCase());
  async function openDoc(kind: "registration" | "id_document") {
    try { const { url } = await docUrl({ data: { submissionId: s.id, kind } }); window.open(url, "_blank", "noopener"); }
    catch (e: any) { toast.error(e?.message || "Could not open"); }
  }
  async function doDecline() {
    const reason = window.prompt("Decline this car? Optional note for the team (not sent to the owner):", "");
    if (reason === null) return;
    try { await decline({ data: { submissionId: s.id, reason: reason || null } }); toast.success("Declined"); onChanged(); }
    catch (e: any) { toast.error(e?.message || "Could not decline"); }
  }
  return (
    <div className="rounded-xl bg-soft p-4" data-testid="partner-submission-card">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[240px]">
          <div className="font-medium">{s.year} {s.make} {s.model}{s.trim ? ` ${s.trim}` : ""} <span className="text-xs text-muted-foreground">· {s.status}</span></div>
          <div className="text-xs text-muted-foreground mt-0.5">VIN {s.vin}{s.plate ? ` · Plate ${s.plate}` : ""}{s.color ? ` · ${s.color}` : ""}{s.mileage != null ? ` · ${s.mileage.toLocaleString()} mi` : ""}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{[s.titleStatus && `Title: ${s.titleStatus}`, s.lienStatus, s.registrationState && `Reg: ${s.registrationState}`, s.condition && `Condition: ${s.condition}`, s.currentlyInsured != null && `Insured now: ${s.currentlyInsured ? "Yes" : "No"}`].filter(Boolean).join(" · ")}</div>
          <div className="text-xs mt-2">{s.fullName}{s.businessName ? ` · ${s.businessName}` : ""} · {s.email} · {s.phone}{s.smsConsent ? " · SMS OK" : ""}</div>
          {s.address && <div className="text-xs text-muted-foreground">{s.address}</div>}
          {s.message && <div className="text-xs mt-1 italic">“{s.message}”</div>}
          <div className="text-[11px] text-muted-foreground mt-1">Submitted {new Date(s.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!s.hasRegistration} onClick={() => openDoc("registration")} className="rounded-md border border-border bg-white px-3 py-1.5 text-xs disabled:opacity-40">{s.hasRegistration ? "Registration" : "No Registration"}</button>
          <button type="button" disabled={!s.hasIdDocument} onClick={() => openDoc("id_document")} className="rounded-md border border-border bg-white px-3 py-1.5 text-xs disabled:opacity-40">{s.hasIdDocument ? "Owner ID" : "No ID"}</button>
          {open && <button type="button" onClick={doDecline} className="rounded-md border border-border bg-white px-3 py-1.5 text-xs">Decline</button>}
          {open && <button type="button" disabled={legacy} onClick={() => setListing(true)} className="rounded-md bg-real-red text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50" data-testid="list-this-car">List This Car</button>}
        </div>
      </div>
      {s.photos.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {s.photos.map((p) => p.url ? <a key={p.path} href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt="" className="h-20 w-28 rounded object-cover bg-white" /></a> : null)}
        </div>
      )}
      {listing && <ListDialog s={s} onClose={() => setListing(false)} onDone={() => { setListing(false); onChanged(); }} />}
    </div>
  );
}

function ListDialog({ s, onClose, onDone }: { s: StaffSubmission; onClose: () => void; onDone: () => void }) {
  const approve = useServerFn(approvePartnerSubmission);
  const [rate, setRate] = useState("");
  const [split, setSplit] = useState("50");
  const [listNow, setListNow] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set(s.photos.map((p) => p.path)));
  const [busy, setBusy] = useState(false);
  async function go() {
    const weeklyRate = rate ? Number(rate) : null;
    if (listNow && !(weeklyRate && weeklyRate > 0)) { toast.error("Enter the weekly rate to list the car."); return; }
    const pct = Number(split);
    if (!(pct > 0 && pct < 100)) { toast.error("Partner split must be between 1 and 99%."); return; }
    setBusy(true);
    try {
      const r = await approve({ data: { submissionId: s.id, listNow, weeklyRate, revenueSplitPct: pct, publishPhotoPaths: [...picked] } });
      toast.success(`${listNow ? "Listed" : "Approved"}. Partner is active.${r.photos.failed ? ` ${r.photos.failed} photo(s) didn't copy.` : ""}`);
      onDone();
    } catch (e: any) { toast.error(e?.message || "Could not list this car"); }
    finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="List this car">
        <h2 className="text-lg font-semibold">List {s.year} {s.make} {s.model}</h2>
        <p className="mt-1 text-xs text-muted-foreground">Makes {s.fullName} an active partner (unlocks their earnings, payouts and bank setup) and adds the car to the fleet.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <label className="block"><span className="text-[11px] text-muted-foreground">Weekly Rate ($)</span>
            <input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="mt-1 w-full rounded-md bg-soft px-3 py-2" placeholder="e.g. 375" /></label>
          <label className="block"><span className="text-[11px] text-muted-foreground">Partner Split (%)</span>
            <input value={split} onChange={(e) => setSplit(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="mt-1 w-full rounded-md bg-soft px-3 py-2" /></label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={listNow} onChange={(e) => setListNow(e.target.checked)} className="h-[18px] w-[18px]" /> List on drivereal.com now (status Available)</label>
        {!listNow && <p className="mt-1 text-xs text-muted-foreground">The car goes in as Needs Setup; photos are copied to its gallery but not published.</p>}
        {s.photos.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] text-muted-foreground mb-1">{listNow ? "Listing photos (first ticked is the lead image)" : "Photos to copy into the gallery"}</div>
            <div className="grid grid-cols-4 gap-2">
              {s.photos.map((p) => (
                <label key={p.path} className={`relative block rounded overflow-hidden border-2 ${picked.has(p.path) ? "border-real-red" : "border-transparent"}`}>
                  <input type="checkbox" className="absolute left-1 top-1 h-[18px] w-[18px]" checked={picked.has(p.path)}
                    onChange={(e) => setPicked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(p.path); else n.delete(p.path); return n; })} />
                  {p.url ? <img src={p.url} alt="" className="h-16 w-full object-cover" /> : <div className="h-16 bg-soft" />}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button type="button" disabled={busy} onClick={go} className="rounded-md bg-real-red text-white px-4 py-2 text-sm font-medium disabled:opacity-60" data-testid="confirm-list">{busy ? "Working…" : listNow ? "List Car & Activate Partner" : "Approve & Activate Partner"}</button>
        </div>
      </div>
    </div>
  );
}

/** Manager+: record a payout for one partner, with an optional receipt the partner can open. */
export function RecordPayoutButton({ partnerId, partnerName }: { partnerId: string; partnerName: string }) {
  const record = useServerFn(recordPartnerPayout);
  const attach = useServerFn(attachPayoutReceipt);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ periodStart: "", periodEnd: "", grossRent: "", partnerShare: "", expenses: "0", net: "", paidAt: "", method: "ach", reference: "" });
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const file = receiptFiles[0] ?? null;
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    if (!f.periodStart || !f.periodEnd || f.net === "") { toast.error("Period and payout amount are required."); return; }
    setBusy(true);
    try {
      const r = await record({ data: {
        partnerId, periodStart: f.periodStart, periodEnd: f.periodEnd, grossRent: Number(f.grossRent || 0), partnerShare: Number(f.partnerShare || 0),
        expenses: Number(f.expenses || 0), net: Number(f.net), paidAt: f.paidAt || null, method: (f.method || null) as any, reference: f.reference || null,
        receipt: file ? { name: file.name, type: file.type || "application/pdf", size: file.size } : null,
      } });
      if (r.upload && file) {
        const { error } = await supabase.storage.from(PARTNER_DOCS_BUCKET).uploadToSignedUrl(r.upload.path, r.upload.token, file, { contentType: file.type || undefined });
        if (error) toast.error("Payout saved, but the receipt didn't upload.");
        else await attach({ data: { payoutId: r.payoutId, path: r.upload.path } });
      }
      toast.success("Payout recorded");
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ["admin", "partner-payouts"] });
    } catch (e: any) { toast.error(e?.message || "Could not record payout"); }
    finally { setBusy(false); }
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-border bg-white px-3 py-1.5 text-xs">Record Payout</button>;
  const input = "mt-1 w-full rounded-md bg-soft px-3 py-2 text-sm";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Record payout">
        <h2 className="text-lg font-semibold">Record Payout — {partnerName}</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <label>Period Start<input type="date" value={f.periodStart} onChange={(e) => set("periodStart", e.target.value)} className={input} /></label>
          <label>Period End<input type="date" value={f.periodEnd} onChange={(e) => set("periodEnd", e.target.value)} className={input} /></label>
          <label>Rent Collected ($)<input value={f.grossRent} onChange={(e) => set("grossRent", e.target.value)} inputMode="decimal" className={input} /></label>
          <label>Partner Share ($)<input value={f.partnerShare} onChange={(e) => set("partnerShare", e.target.value)} inputMode="decimal" className={input} /></label>
          <label>Expenses ($)<input value={f.expenses} onChange={(e) => set("expenses", e.target.value)} inputMode="decimal" className={input} /></label>
          <label>Payout ($)<input value={f.net} onChange={(e) => set("net", e.target.value)} inputMode="decimal" className={input} /></label>
          <label>Paid On<input type="date" value={f.paidAt} onChange={(e) => set("paidAt", e.target.value)} className={input} /></label>
          <label>Method<AppSelect aria-label="Payout Method" value={f.method} onChange={(e) => set("method", e.target.value)} className={input}><option value="ach">ACH</option><option value="stripe_transfer">Stripe Transfer</option><option value="zelle">Zelle</option><option value="check">Check</option><option value="other">Other</option></AppSelect></label>
          <label className="col-span-2">Reference (Optional)<input value={f.reference} onChange={(e) => set("reference", e.target.value)} className={input} /></label>
          <div className="col-span-2">Receipt / Statement (PDF Or Image)
            <FileUploader value={receiptFiles} onChange={setReceiptFiles} accept="application/pdf,image/*" maxFiles={1} maxBytes={25 * 1024 * 1024} variant="inline" label="Attach Receipt" disabled={busy} />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">The partner sees the period, amounts, paid date and the receipt in their portal.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button type="button" disabled={busy} onClick={save} className="rounded-md bg-real-red text-white px-4 py-2 text-sm disabled:opacity-60">{busy ? "Saving…" : "Save Payout"}</button>
        </div>
      </div>
    </div>
  );
}
