import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Paperclip, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import { AdminTableScroll } from "./AdminTableScroll";
import { EmptyState, MicroLabel } from "./ui";
import { fmtDate } from "@/lib/date-format";
import {
  REIMBURSEMENT_METHODS,
  REIMBURSEMENT_REASONS,
  parseReimbursementAmount,
  reimbursementProblem,
  todayEasternISO,
} from "@/lib/renter-reimbursements";
import {
  createRenterReimbursement,
  deleteRenterReimbursement,
  listReimbursementRenters,
  listRenterReimbursements,
  type ReimbursementRenterChoice,
  type RenterReimbursement,
} from "@/lib/renter-reimbursements.functions";

// Expenses → Renter Reimbursements. Money paid back to a renter, kept apart
// from vehicle costs so it is clear who was paid and why. Manager-only.

function money2(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm max-lg:min-w-0";

export function RenterReimbursements({ from, to }: { from: string | null; to: string | null }) {
  const list = useServerFn(listRenterReimbursements);
  const remove = useServerFn(deleteRenterReimbursement);
  const [rows, setRows] = useState<RenterReimbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    list({ data: { from: from ?? undefined, to: to ?? undefined } })
      .then(setRows)
      .catch((e) => toast.error(e?.message === "Forbidden" ? "Reimbursements Are Manager-Only." : "Could Not Load Reimbursements."))
      .finally(() => setLoading(false));
  }, [list, from, to]);
  useEffect(load, [load]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  async function del(row: RenterReimbursement) {
    if (!window.confirm(`Delete the ${money2(row.amount)} reimbursement to ${row.renter_name}?`)) return;
    const res = await remove({ data: { id: row.id } });
    if (!res.ok) return toast.error(res.error);
    toast.success("Reimbursement Deleted");
    load();
  }

  return (
    <div className="space-y-3" data-testid="renter-reimbursements">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold">Renter Reimbursements</h3>
          <p className="text-xs text-muted-foreground">Money Paid Back To Renters. {rows.length ? `${rows.length} · ${money2(total)}` : ""}</p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-real-red px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="w-4 h-4" /> Add Reimbursement
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No Reimbursements Yet" hint="Record money paid back to a renter, like lost revenue while their car was down." />
      ) : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                {["Date", "Renter", "Reason", "Method", "Reference", "Amount", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.paid_on)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.renter_name}</div>
                    {r.vehicle_label ? <div className="text-xs text-muted-foreground">{r.vehicle_label}</div> : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.reason_label}
                    {r.notes ? <div className="text-xs text-muted-foreground line-clamp-2 max-w-xs">{r.notes}</div> : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.method_label}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.reference ?? ""}
                    {r.receipt_url ? (
                      <a href={r.receipt_url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-[#D03020]">
                        <Paperclip className="w-3 h-3" /> Receipt
                      </a>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{money2(r.amount)}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => del(r)} aria-label="Delete Reimbursement" className="text-muted-foreground hover:text-[#D03020]">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableScroll>
      )}

      {adding ? (
        <ReimbursementForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function ReimbursementForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const renters = useServerFn(listReimbursementRenters);
  const save = useServerFn(createRenterReimbursement);
  const [choices, setChoices] = useState<ReimbursementRenterChoice[]>([]);
  const [rentalId, setRentalId] = useState("");
  const [paidOn, setPaidOn] = useState(() => todayEasternISO());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("zelle");
  const [reason, setReason] = useState("lost_revenue");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<{ path: string; name: string; mime: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    renters({ data: {} })
      .then((list) => {
        setChoices(list);
        if (list[0]) setRentalId(list[0].rentalId);
      })
      .catch(() => toast.error("Could Not Load Renters."));
  }, [renters]);

  const chosen = choices.find((c) => c.rentalId === rentalId) ?? null;

  async function handleReceipt(file: File, onProgress: (pct: number) => void) {
    setUploading(true);
    try {
      onProgress(10);
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `reimbursements/${chosen?.applicationId ?? "unassigned"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file, { contentType: file.type || undefined });
      if (error) throw error;
      onProgress(90);
      setReceipt({ path, name: file.name, mime: file.type || "application/octet-stream" });
      toast.success("Receipt Attached");
    } catch (e) {
      toast.error("Could Not Upload That Receipt.");
      throw e;
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const draft = {
      applicationId: chosen?.applicationId ?? "",
      rentalId: chosen?.rentalId ?? null,
      vehicleId: chosen?.vehicleId ?? null,
      paidOn,
      amount,
      method,
      reason,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    };
    const problem = reimbursementProblem(draft);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      const res = await save({
        data: {
          ...draft,
          amount: parseReimbursementAmount(amount)!,
          method: method as any,
          reason: reason as any,
          receiptPath: receipt?.path ?? null,
          receiptName: receipt?.name ?? null,
          receiptMime: receipt?.mime ?? null,
        },
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Reimbursement Recorded");
      onSaved();
    } catch (err: any) {
      toast.error(err?.message === "Forbidden" ? "Reimbursements Are Manager-Only." : "Could Not Save The Reimbursement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <form onSubmit={submit} className="bg-white rounded-xl p-6 max-w-lg w-full space-y-3 my-8 max-lg:min-w-0">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Add Reimbursement</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Field label="Renter" full>
            <select value={rentalId} onChange={(e) => setRentalId(e.target.value)} className={input} aria-label="Renter">
              {choices.map((c) => (
                <option key={c.rentalId} value={c.rentalId}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Amount ($)">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className={input} aria-label="Amount" />
          </Field>
          <Field label="Date Paid">
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={input} aria-label="Date Paid" />
          </Field>
          <Field label="Paid With">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={input} aria-label="Paid With">
              {REIMBURSEMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Reason">
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={input} aria-label="Reason">
              {REIMBURSEMENT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Reference" full>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Confirmation Number" className={input} aria-label="Reference" />
          </Field>
          <Field label="Notes" full>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={input} aria-label="Notes" />
          </Field>
        </div>
        <div>
          <MicroLabel>Receipt</MicroLabel>
          <FileUploader
            className="mt-1"
            variant="zone"
            title="Drop The Receipt Here"
            label={receipt ? "Replace Receipt" : "Attach Receipt"}
            hint="Screenshot Or PDF, Up To 10 MB"
            context={`${chosen?.label ?? "Renter"} · Reimbursement Receipt`}
            accept="image/*,application/pdf"
            maxBytes={10 * 1024 * 1024}
            camera
            disabled={saving}
            upload={(file, { onProgress }) => handleReceipt(file, onProgress)}
          />
        </div>
        <button disabled={saving || uploading || !chosen} className="w-full rounded-lg bg-real-red text-white py-2.5 text-sm font-medium disabled:opacity-60">
          {saving ? "Saving…" : "Save Reimbursement"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "lg:col-span-2 max-lg:min-w-0" : "max-lg:min-w-0"}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}
