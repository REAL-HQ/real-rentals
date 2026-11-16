import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listFleetNeedsStaff, resolveFleetNeedsStaff, type FleetNeedsStaffFlag } from "@/lib/fleet-review.functions";

/**
 * Shown on a driver profile while FLEET has sent the applicant to staff
 * (needs_staff). Managers clear it once they have decided.
 */
export function FleetNeedsStaffBanner({ applicationId, canResolve, flags }: { applicationId: string; canResolve: boolean; flags?: FleetNeedsStaffFlag[] | null }) {
  const load = useServerFn(listFleetNeedsStaff);
  const resolve = useServerFn(resolveFleetNeedsStaff);
  const [flag, setFlag] = useState<FleetNeedsStaffFlag | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const pick = (list: FleetNeedsStaffFlag[]) => list.find((f) => f.applicationId === applicationId) ?? null;
    if (flags) { setFlag(pick(flags)); return; }
    load().then((r) => { if (!cancelled) setFlag(pick(r.flags)); }).catch(() => { if (!cancelled) setFlag(null); });
    return () => { cancelled = true; };
  }, [applicationId, flags, load]);
  if (!flag) return null;
  async function clear() {
    if (!flag || busy) return;
    setBusy(true);
    try {
      const r = await resolve({ data: { id: flag.id } });
      if (!r.ok) throw new Error(r.error ?? "Could Not Clear The Flag.");
      setFlag(null);
      toast.success("Needs Staff Cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Clear The Flag.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="status" data-fleet-needs-staff className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-[#F5C2BC] bg-[#FDF1EF] px-4 py-3 text-sm text-[#7A1B12]">
      <span className="rounded-full bg-[#D03020] px-2 py-0.5 text-[11px] font-semibold text-white">Needs Staff</span>
      <span className="min-w-0 flex-1">FLEET Sent This To Staff: {flag.reason}</span>
      {canResolve ? (
        <button type="button" disabled={busy} onClick={() => void clear()} className="inline-flex h-8 items-center rounded-md border border-[#D6D6DB] bg-white px-3 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50">
          {busy ? "Clearing…" : "Mark Handled"}
        </button>
      ) : null}
    </div>
  );
}
