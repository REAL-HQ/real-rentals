import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getLateFeeLedger, type LateFeeLedgerResponse } from "@/lib/late-fee-forgiveness.functions";
import { forgivableFees, r2 } from "@/lib/late-fee-ledger";
import { ManageLateFeesDialog } from "./ManageLateFeesDialog";

// Driver profile > Payments: this rental's late fees at a glance, and the way
// into Manage Late Fees. Managers and Owners only (the parent decides).

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function LateFeesCard({ rentalId, driverName }: { rentalId: string; driverName: string }) {
  const read = useServerFn(getLateFeeLedger);
  const [data, setData] = useState<LateFeeLedgerResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    read({ data: { rentalId } })
      .then((res) => { if (alive) setData(res); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [read, rentalId, reload]);

  const unpaid = data ? r2(forgivableFees(data.ledger).reduce((t, f) => t + f.open, 0)) : 0;
  const forgiven = data ? r2(data.ledger.totalForgiven + data.ledger.totalWaived) : 0;
  return (
    <section aria-label="Late Fees" className="rounded-xl border border-border bg-white shadow-[0_1px_0_rgba(0,0,0,0.02)]" data-testid="late-fees-card">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[#111114]">Late Fees</h2>
          <p className="mt-1 text-[12px] text-[#9A9AA3]">
            {failed ? "Late Fees Could Not Be Loaded." : !data ? "Loading…" : `Unpaid ${usd(unpaid)} · Forgiven ${usd(forgiven)} · Paid ${usd(data.ledger.totalPaid)}`}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-3 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50"
          disabled={!data}
          onClick={() => setOpen(true)}
        >
          Manage Late Fees
        </button>
      </div>
      {open ? (
        <ManageLateFeesDialog open onOpenChange={setOpen} rentalId={rentalId} driverName={driverName} onChanged={() => setReload((n) => n + 1)} />
      ) : null}
    </section>
  );
}
