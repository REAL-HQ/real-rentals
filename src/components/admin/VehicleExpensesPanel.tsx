import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Wallet } from "lucide-react";
import { getVehicleExpenses, saveVehicleExpense } from "@/lib/vehicle-expenses.functions";
import { BUCKET_LABELS, VEHICLE_EXPENSE_BUCKETS, type VehicleExpenseBucket, type VehicleExpenseReport } from "@/lib/vehicle-expenses";
import type { VehicleExpensesResponse } from "@/lib/vehicle-expenses.server";
import { AdminTableScroll } from "./AdminTableScroll";
import { EmptyState } from "./ui";

/**
 * Manager read of the Owner P&L expense line, per vehicle.
 * Mounted only while VEHICLE_EXPENSES_ENABLED is true.
 * Entry posts to saveVehicleExpense, which does not write while the proposal is unapplied.
 */

function money(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function VehicleExpensesPanel() {
  const read = useServerFn(getVehicleExpenses);
  const save = useServerFn(saveVehicleExpense);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [response, setResponse] = useState<VehicleExpensesResponse | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [category, setCategory] = useState<VehicleExpenseBucket>("maintenance");
  const [incurredOn, setIncurredOn] = useState("");
  const [amount, setAmount] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [receiptName, setReceiptName] = useState("");
  const [entryNote, setEntryNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    read()
      .then((result) => {
        if (cancelled) return;
        setResponse(result);
        setProblem(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "The expense line could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  const report: VehicleExpenseReport | null = response?.status === "ready" ? response.report : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setEntryNote(null);
    const result = await save();
    setEntryNote(result.status === "disabled" ? "Vehicle Expenses Is Off" : result.reason);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Maintenance, insurance, registration, tolls, cleaning, and other, per vehicle. This is the Owner P&L expense line. A linked service expense is counted once, and total cost is not added again.
      </p>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {problem && <p className="text-sm text-[#D03020]">{problem}</p>}
      {response?.status === "disabled" && <p className="text-sm text-muted-foreground">Vehicle Expenses Is Off</p>}
      {response?.status === "unavailable" && <p className="text-sm text-[#D03020]">{response.reason}</p>}
      {report && (
        <div className="space-y-4">
          <p className="text-sm">Expense Line {money(report.expenseCents)}</p>
          {report.notes.map((note) => <p key={note} className="text-sm text-[#D03020]">{note}</p>)}
          {report.vehicles.length === 0 ? (
            <EmptyState icon={<Wallet className="w-6 h-6" strokeWidth={1.75} />} title="No Expenses On File" hint="Costs for each car will show here." />
          ) : (
            report.vehicles.map((vehicle) => (
              <section key={vehicle.vehicleId} className="space-y-2">
                <h2 className="text-base font-semibold">{vehicle.label}</h2>
                <p className="text-sm text-muted-foreground">
                  {VEHICLE_EXPENSE_BUCKETS.map((bucket) => `${BUCKET_LABELS[bucket]} ${money(vehicle.buckets[bucket])}`).join(" · ")}
                  {" · "}Expense Line {money(vehicle.expenseCents)}
                </p>
                {vehicle.entries.length > 0 && (
                  <AdminTableScroll className="rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-[#FAFAFB] text-left">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">Date</th>
                          <th className="px-4 py-2.5 font-medium">Category</th>
                          <th className="px-4 py-2.5 font-medium">Vendor</th>
                          <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                          <th className="px-4 py-2.5 font-medium">Receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vehicle.entries.map((entry) => (
                          <tr key={entry.id} className="border-t border-border">
                            <td className="px-4 py-3">{entry.date}</td>
                            <td className="px-4 py-3">{BUCKET_LABELS[entry.bucket]}</td>
                            <td className="px-4 py-3">{entry.vendor}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{money(entry.amountCents)}</td>
                            <td className="px-4 py-3">{entry.receiptOnFile ? "On File" : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </AdminTableScroll>
                )}
              </section>
            ))
          )}
          <form onSubmit={onSubmit} className="rounded-xl border border-border p-4 space-y-3">
            <h2 className="text-base font-semibold">Enter An Expense</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm block">Vehicle
                <select className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
                  <option value="">Select A Vehicle</option>
                  {report.vehicles.map((vehicle) => <option key={vehicle.vehicleId} value={vehicle.vehicleId}>{vehicle.label}</option>)}
                </select>
              </label>
              <label className="text-sm block">Category
                <select className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5" value={category} onChange={(event) => setCategory(event.target.value as VehicleExpenseBucket)}>
                  {VEHICLE_EXPENSE_BUCKETS.map((bucket) => <option key={bucket} value={bucket}>{BUCKET_LABELS[bucket]}</option>)}
                </select>
              </label>
              <label className="text-sm block">Date
                <input className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5" type="date" value={incurredOn} onChange={(event) => setIncurredOn(event.target.value)} />
              </label>
              <label className="text-sm block">Amount
                <input className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label className="text-sm block">Vendor
                <input className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5" value={vendorName} onChange={(event) => setVendorName(event.target.value)} />
              </label>
              <label className="text-sm block">Receipt
                <input className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5" type="file" onChange={(event) => setReceiptName(event.target.files?.[0]?.name ?? "")} />
              </label>
            </div>
            <button type="submit" className="rounded-md bg-[#111114] px-3 py-1.5 text-sm text-white">Save Expense</button>
            {entryNote && <p className="text-sm text-[#D03020]">{entryNote}</p>}
            {receiptName ? <p className="text-xs text-muted-foreground">{receiptName}</p> : null}
          </form>
        </div>
      )}
    </div>
  );
}
