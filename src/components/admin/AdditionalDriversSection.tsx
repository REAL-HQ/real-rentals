import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { additionalDriverMayDrive, additionalDriverStatusLabel, type AdditionalDriverRow } from "@/lib/additional-drivers";
import { approveAdditionalDriver, billAdditionalDriverWeekly, declineAdditionalDriver, listStaffAdditionalDrivers, markAdditionalDriverInsurance, removeAdditionalDriver } from "@/lib/additional-drivers.functions";

const btn = "h-8 rounded-lg border border-border bg-white px-2.5 text-[12px] font-medium text-[#111114] hover:bg-[#F4F4F6]";

export function AdditionalDriverBadge({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-[#F4F4F6] px-2 py-0.5 text-[11px] font-medium text-[#111114]">
      Additional Driver
    </span>
  );
}

export function AdditionalDriversPanel({
  rows,
  reservationFeeSettled,
  onChanged,
}: {
  rows: AdditionalDriverRow[];
  reservationFeeSettled: boolean;
  onChanged: () => void;
}) {
  const approve = useServerFn(approveAdditionalDriver);
  const decline = useServerFn(declineAdditionalDriver);
  const insure = useServerFn(markAdditionalDriverInsurance);
  const bill = useServerFn(billAdditionalDriverWeekly);
  const remove = useServerFn(removeAdditionalDriver);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id);
    try {
      await action();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update this driver");
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) {
    return <p className="text-[13px] text-[#55555E]">No additional drivers on this rental.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-white">
      {rows.map((row) => {
        const mayDrive = additionalDriverMayDrive({ ...row, reservationFeeSettled });
        return (
          <li key={row.id} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[14px] font-semibold text-[#111114]">{row.name}</p>
                <p className="text-[12px] text-[#55555E]">{row.relationship || "Driver"} · {row.email || "No email"} · {row.phone || "No phone"}</p>
              </div>
              <span className="rounded-full border border-border bg-[#F4F4F6] px-2 py-0.5 text-[11px] font-medium text-[#111114]">
                {additionalDriverStatusLabel(row.status)}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-[#55555E]">
              <div>License {row.licenseState} {row.licenseNumber}</div>
              <div>Expires {row.licenseExpiration || "—"}</div>
              <div>Signed {row.signedAt ? "Yes" : "Not Yet"}</div>
              <div>Insurance {row.insuranceAddedAt ? row.insuranceAddedAt.slice(0, 10) : "Not Added"}</div>
              <div>Weekly bill {row.stripeSubscriptionItemId ? "$100" : "Not Added"}</div>
              <div>{mayDrive ? "May Drive" : "May Not Drive Yet"}</div>
            </dl>
            {row.status !== "removed" ? (
              <div className="flex flex-wrap gap-2">
                {row.status === "pending" ? <button type="button" className={btn} disabled={busy === row.id} onClick={() => run(row.id, () => approve({ data: { id: row.id } }))}>Approve</button> : null}
                {row.status === "pending" ? <button type="button" className={btn} disabled={busy === row.id} onClick={() => run(row.id, () => decline({ data: { id: row.id } }))}>Decline</button> : null}
                {row.status === "approved" && !row.insuranceAddedAt ? <button type="button" className={btn} disabled={busy === row.id} onClick={() => run(row.id, () => insure({ data: { id: row.id } }))}>Mark Insurance Added</button> : null}
                {row.status === "approved" && !row.stripeSubscriptionItemId ? <button type="button" className={btn} disabled={busy === row.id} onClick={() => run(row.id, () => bill({ data: { id: row.id } }))}>Add $100/Week</button> : null}
                <button type="button" className={btn} disabled={busy === row.id} onClick={() => run(row.id, () => remove({ data: { id: row.id } }))}>Remove</button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function AdditionalDriverBadgeSlot({ applicationId, rentalId }: { applicationId?: string | null; rentalId?: string | null }) {
  const load = useServerFn(listStaffAdditionalDrivers);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!applicationId && !rentalId) return;
    let live = true;
    void load({ data: { applicationId: applicationId ?? undefined, rentalId: rentalId ?? undefined } })
      .then((res) => { if (live) setCount(res.rows.filter((r) => r.status === "approved" && !r.removedAt).length); })
      .catch(() => { if (live) setCount(0); });
    return () => { live = false; };
  }, [applicationId, rentalId, load]);
  return <AdditionalDriverBadge count={count} />;
}

export function AdditionalDriversSection({ applicationId, rentalId }: { applicationId?: string | null; rentalId?: string | null }) {
  const load = useServerFn(listStaffAdditionalDrivers);
  const [rows, setRows] = useState<AdditionalDriverRow[]>([]);
  const [fee, setFee] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!applicationId && !rentalId) return;
    let live = true;
    void load({ data: { applicationId: applicationId ?? undefined, rentalId: rentalId ?? undefined } })
      .then((res) => { if (live) { setHidden(false); setRows(res.rows); setFee(res.reservationFeeSettled); } })
      .catch(() => { if (live) setHidden(true); });
    return () => { live = false; };
  }, [applicationId, rentalId, nonce, load]);
  if (!applicationId && !rentalId || hidden) return null;
  return (
    <section className="rounded-2xl border border-border bg-white p-4" aria-label="Additional Drivers">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#111114]">Additional Drivers</h2>
        <AdditionalDriverBadge count={rows.filter((r) => r.status === "approved" && !r.removedAt).length} />
      </div>
      <AdditionalDriversPanel rows={rows} reservationFeeSettled={fee} onChanged={() => setNonce((n) => n + 1)} />
    </section>
  );
}
