import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import { createOwnerExpense, listOwnerExpenseChoices } from "@/lib/owner-expense-entry.functions";
import { EXPENSE_CATEGORIES, todayEastern, type ExpenseCategory } from "@/lib/owner-expense-entry";

/**
 * Owner form for one new vehicle expense. Mounted only while
 * OWNER_EXPENSE_ENTRY_ENABLED is true. The receipt uses the existing receipts
 * bucket and FileUploader. There is no edit and no delete.
 */

type Receipt = { path: string; name: string; mime: string };

export function OwnerExpenseEntryPanel() {
  const load = useServerFn(listOwnerExpenseChoices);
  const save = useServerFn(createOwnerExpense);
  const [vehicles, setVehicles] = useState<{ id: string; label: string }[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [incurredOn, setIncurredOn] = useState(() => todayEastern());
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("repair");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load({ data: {} })
      .then((result) => {
        if (cancelled) return;
        setVehicles(result.vehicles);
        setVendors(result.vendors);
        setVehicleId((current) => current || result.vehicles[0]?.id || "");
      })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "Could not load expenses");
      });
    return () => { cancelled = true; };
  }, [load]);

  async function uploadReceipt(file: File, onProgress: (pct: number) => void) {
    setUploading(true);
    try {
      onProgress(10);
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${vehicleId || "unassigned"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file, { contentType: file.type || undefined });
      if (error) throw error;
      onProgress(90);
      setReceipt({ path, name: file.name, mime: file.type || "application/octet-stream" });
      toast.success("Receipt attached");
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setProblem(null);
    try {
      await save({
        data: {
          vehicleId,
          incurredOn,
          amount,
          category,
          vendorId: vendorId || null,
          description,
          notes,
          receiptPath: receipt?.path ?? null,
          receiptName: receipt?.name ?? null,
          receiptMime: receipt?.mime ?? null,
        },
      });
      toast.success("Expense recorded");
      setAmount("");
      setDescription("");
      setNotes("");
      setReceipt(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not save the expense.";
      setProblem(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const vehicleLabel = vehicles.find((vehicle) => vehicle.id === vehicleId)?.label ?? "Expense";

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Expense Entry</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Add one vehicle expense. The date is an Eastern Time calendar date. A receipt is optional.
        </p>
      </div>
      {problem && <p className="text-sm text-[#D03020]">{problem}</p>}
      <label className="block text-sm">
        <span className="font-medium">Vehicle</span>
        <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2">
          {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Date</span>
          <input type="date" aria-label="Date" value={incurredOn} onChange={(event) => setIncurredOn(event.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Amount</span>
          <input inputMode="decimal" aria-label="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" className="mt-1 w-full rounded-lg border border-border px-3 py-2" />
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-medium">Category</span>
        <select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2">
          {EXPENSE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Vendor</span>
        <select value={vendorId} onChange={(event) => setVendorId(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2">
          <option value="">No Vendor</option>
          {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Description</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Note</span>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-border px-3 py-2" />
      </label>
      <div>
        <p className="text-sm font-medium">Receipt</p>
        <FileUploader
          className="mt-1"
          variant="zone"
          title="Drop The Receipt Here"
          label={receipt ? "Replace Receipt" : "Attach Receipt"}
          hint="Optional. Photo or PDF, up to 10 MB."
          context={`${vehicleLabel} · Receipt`}
          accept="image/*,application/pdf"
          maxBytes={10 * 1024 * 1024}
          camera
          disabled={saving}
          upload={(file, { onProgress }) => uploadReceipt(file, onProgress)}
        />
      </div>
      <button type="submit" disabled={saving || uploading} className="rounded-lg bg-real-red text-white px-4 py-2.5 text-sm font-medium disabled:opacity-60">
        {saving ? "Saving…" : "Save Expense"}
      </button>
    </form>
  );
}
