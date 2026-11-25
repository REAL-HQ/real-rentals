import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { additionalDriverFieldError, additionalDriverMayDrive, additionalDriverStatusLabel, type AdditionalDriverInput, type AdditionalDriverRow } from "@/lib/additional-drivers";
import { addStaffAdditionalDriver, approveAdditionalDriver, billAdditionalDriverWeekly, declineAdditionalDriver, listStaffAdditionalDrivers, markAdditionalDriverInsurance, removeAdditionalDriver } from "@/lib/additional-drivers.functions";

const btn = "h-8 rounded-lg border border-border bg-white px-2.5 text-[12px] font-medium text-[#111114] hover:bg-[#F4F4F6]";
const solid = "h-8 rounded-lg bg-[#111114] px-2.5 text-[12px] font-semibold text-white hover:bg-[#2A2A30] disabled:opacity-50";
const field = "mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-[13px] text-[#111114]";

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const emptyDriver = (): AdditionalDriverInput => ({
  name: "", email: "", phone: "", dob: "", licenseNumber: "", licenseState: "", licenseExpiration: "", licensePhotoPath: null, relationship: "", smsConsent: false,
});

export function AdditionalDriverBadge({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-[#F4F4F6] px-2 py-0.5 text-[11px] font-medium text-[#111114]">
      Additional Driver
    </span>
  );
}

function feeIncluded(row: AdditionalDriverRow, rows: AdditionalDriverRow[], includedDriverCount: number): boolean {
  if (row.stripeSubscriptionItemId || row.status !== "approved" || row.removedAt) return false;
  const index = rows.filter((r) => r.status === "approved" && !r.removedAt).findIndex((r) => r.id === row.id);
  return index >= 0 && index < includedDriverCount;
}

export function AdditionalDriversPanel({
  rows,
  reservationFeeSettled,
  includedDriverCount = 0,
  onChanged,
}: {
  rows: AdditionalDriverRow[];
  reservationFeeSettled: boolean;
  includedDriverCount?: number;
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
    return <p className="text-[13px] text-[#55555E]">No additional drivers.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-white">
      {rows.map((row) => {
        const mayDrive = additionalDriverMayDrive({ ...row, reservationFeeSettled });
        const included = feeIncluded(row, rows, includedDriverCount);
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
              <div>Weekly Bill {row.stripeSubscriptionItemId ? "$100" : included ? "Included In Weekly Rate" : "Not Added"}</div>
              <div>{mayDrive ? "May Drive" : "May Not Drive Yet"}</div>
            </dl>
            {row.status !== "removed" ? (
              <div className="flex flex-wrap gap-2">
                {row.status === "pending" ? <button type="button" className={btn} disabled={busy === row.id} onClick={() => run(row.id, () => approve({ data: { id: row.id } }))}>Approve</button> : null}
                {row.status === "pending" ? <button type="button" className={btn} disabled={busy === row.id} onClick={() => run(row.id, () => decline({ data: { id: row.id } }))}>Decline</button> : null}
                {row.status === "approved" && !row.insuranceAddedAt ? <button type="button" className={btn} disabled={busy === row.id} onClick={() => run(row.id, () => insure({ data: { id: row.id } }))}>Mark Insurance Added</button> : null}
                {row.status === "approved" && !row.stripeSubscriptionItemId && included ? <button type="button" className={btn} disabled>Included In Weekly Rate</button> : null}
                {row.status === "approved" && !row.stripeSubscriptionItemId && !included ? <button type="button" className={btn} disabled={busy === row.id} onClick={() => run(row.id, () => bill({ data: { id: row.id } }))}>Add $100/Week</button> : null}
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

export function AddAdditionalDriverForm({
  busy = false,
  error = null,
  onCancel,
  onSubmit,
}: {
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (driver: AdditionalDriverInput) => void;
}) {
  const [driver, setDriver] = useState<AdditionalDriverInput>(emptyDriver);
  const [localError, setLocalError] = useState<string | null>(null);
  const shown = localError || error;
  function set<K extends keyof AdditionalDriverInput>(key: K, value: AdditionalDriverInput[K]) {
    setDriver((d) => ({ ...d, [key]: value }));
    setLocalError(null);
  }
  return (
    <form
      className="mb-3 space-y-2 rounded-xl border border-border bg-white p-3"
      data-testid="add-additional-driver-form"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = additionalDriverFieldError(driver, todayEt());
        if (problem) {
          setLocalError(problem);
          return;
        }
        onSubmit({ ...driver, licensePhotoPath: null, licenseState: driver.licenseState.trim().toUpperCase() });
      }}
    >
      <label className="block text-[12px] font-medium text-[#111114]">Full Name
        <input className={field} value={driver.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" />
      </label>
      <label className="block text-[12px] font-medium text-[#111114]">Email
        <input className={field} type="email" value={driver.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />
      </label>
      <label className="block text-[12px] font-medium text-[#111114]">Phone
        <input className={field} value={driver.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
      </label>
      <label className="block text-[12px] font-medium text-[#111114]">Date of Birth
        <input className={field} type="date" value={driver.dob} onChange={(e) => set("dob", e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[12px] font-medium text-[#111114]">License Number
          <input className={field} value={driver.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} />
        </label>
        <label className="block text-[12px] font-medium text-[#111114]">License State
          <input className={field} maxLength={2} value={driver.licenseState} onChange={(e) => set("licenseState", e.target.value.toUpperCase())} />
        </label>
      </div>
      <label className="block text-[12px] font-medium text-[#111114]">License Expiration
        <input className={field} type="date" value={driver.licenseExpiration} onChange={(e) => set("licenseExpiration", e.target.value)} />
      </label>
      <label className="block text-[12px] font-medium text-[#111114]">Relationship
        <input className={field} value={driver.relationship} onChange={(e) => set("relationship", e.target.value)} />
      </label>
      <label className="flex items-start gap-2 text-[13px] text-[#55555E]">
        <input type="checkbox" checked={driver.smsConsent} onChange={(e) => set("smsConsent", e.target.checked)} />
        This driver agrees to texts about the car, pickup, and their own signing link. Reply STOP to opt out.
      </label>
      {shown ? <p className="text-[13px] text-[#D03020]" role="alert">{shown}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={solid} disabled={busy} data-testid="add-additional-driver-submit">{busy ? "Saving…" : "Add Driver"}</button>
        <button type="button" className={btn} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

export function AdditionalDriversSection({ applicationId, rentalId }: { applicationId?: string | null; rentalId?: string | null }) {
  const load = useServerFn(listStaffAdditionalDrivers);
  const add = useServerFn(addStaffAdditionalDriver);
  const [rows, setRows] = useState<AdditionalDriverRow[]>([]);
  const [fee, setFee] = useState(false);
  const [includedDriverCount, setIncludedDriverCount] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!applicationId && !rentalId) return;
    let live = true;
    void load({ data: { applicationId: applicationId ?? undefined, rentalId: rentalId ?? undefined } })
      .then((res) => { if (live) { setHidden(false); setRows(res.rows); setFee(res.reservationFeeSettled); setIncludedDriverCount(res.includedDriverCount ?? 0); } })
      .catch(() => { if (live) setHidden(true); });
    return () => { live = false; };
  }, [applicationId, rentalId, nonce, load]);
  if (!applicationId && !rentalId || hidden) return null;
  return (
    <section className="rounded-2xl border border-border bg-white p-4" aria-label="Additional Drivers">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#111114]">Additional Drivers</h2>
        <div className="flex items-center gap-2">
          <AdditionalDriverBadge count={rows.filter((r) => r.status === "approved" && !r.removedAt).length} />
          <button type="button" className={btn} data-testid="add-additional-driver" onClick={() => { setAdding(true); setError(null); }}>Add Additional Driver</button>
        </div>
      </div>
      {adding ? (
        <AddAdditionalDriverForm
          busy={busy}
          error={error}
          onCancel={() => { setAdding(false); setError(null); }}
          onSubmit={async (driver) => {
            setBusy(true);
            setError(null);
            try {
              await add({ data: { applicationId: applicationId ?? null, rentalId: rentalId ?? null, ...driver, licensePhotoPath: null } });
              setAdding(false);
              setNonce((n) => n + 1);
              toast.success("Additional Driver Added");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not add this driver.");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
      <AdditionalDriversPanel rows={rows} reservationFeeSettled={fee} includedDriverCount={includedDriverCount} onChanged={() => setNonce((n) => n + 1)} />
    </section>
  );
}
