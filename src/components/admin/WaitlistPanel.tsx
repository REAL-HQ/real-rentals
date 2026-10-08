import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Car, Hourglass, MailCheck, UserPlus } from "lucide-react";
import {
  listWaitlist,
  setCarsAvailable,
  notifyWaitlistTop,
  promoteToApplicant,
  type WaitlistEntry,
} from "@/lib/waitlist.functions";
import { AdminTableScroll } from "./AdminTableScroll";
import { EmptyState, MicroLabel, SectionCard, StatusPill } from "./ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Waitlist back office.
//
// One number drives everything: how many cars are available right now. Above
// zero the public site shows a scarcity line and takes applications; at zero
// it collects waitlist spots instead. This panel is where that number is set,
// where the queue lives, and where a 0→available opening offers to email the
// top of the queue before the news goes anywhere else.

export function WaitlistPanel({
  onEntriesChange,
  onPromoted,
}: {
  /** Reports the live count of entries not yet promoted (for the Drivers filter). */
  onEntriesChange?: (n: number) => void;
  onPromoted?: () => void;
} = {}) {
  const list = useServerFn(listWaitlist);
  const saveAvailability = useServerFn(setCarsAvailable);
  const notifyTop = useServerFn(notifyWaitlistTop);
  const promote = useServerFn(promoteToApplicant);

  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);
  const [carsAvailable, setCarsAvailableState] = useState<number | null>(null);
  const [countInput, setCountInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyCount, setNotifyCount] = useState("5");
  const [promotingId, setPromotingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await list();
    setEntries(r.entries);
    setCarsAvailableState(r.carsAvailable);
    onEntriesChange?.(r.entries.filter((e) => e.status !== "promoted").length);
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  useEffect(() => {
    refresh().catch((e) => toast.error(e?.message ?? "Could not load the waitlist."));
  }, [refresh]);

  const waitingCount = entries?.filter((e) => e.status === "waiting").length ?? 0;

  async function handleSave(clear: boolean) {
    setSaving(true);
    try {
      let next: number | null = null;
      if (!clear) {
        const raw = countInput.trim();
        const n = Number(raw);
        if (raw === "" || !Number.isInteger(n) || n < 0) {
          toast.error("Enter a whole number — 0 puts the site in waitlist mode.");
          return;
        }
        next = n;
      }
      const res = await saveAvailability({ data: { count: next } });
      if (!res.ok) throw new Error(res.error ?? "Could not save.");
      setCountInput("");
      const r = await refresh();
      if (next === 0) {
        toast.success("Waitlist mode is on — the site now collects waitlist signups.");
      } else if (next === null) {
        toast.success("Availability cleared — the site no longer shows a scarcity or waitlist message.");
      } else {
        toast.success(`Saved — ${next} ${next === 1 ? "car" : "cars"} available.`);
        // Coming back from empty is the moment somebody on the list should
        // hear about it, before the car is advertised anywhere else.
        if ((res.previous === 0 || res.previous === null) && r.waitingCount > 0) {
          setNotifyCount(String(Math.min(5, r.waitingCount)));
          setNotifyOpen(true);
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleNotify() {
    const n = Number(notifyCount);
    if (!Number.isInteger(n) || n < 1) {
      toast.error("Enter how many drivers to email.");
      return;
    }
    try {
      const res = await notifyTop({ data: { limit: n } });
      toast.success(
        res.notified === 1
          ? "Emailed the first driver on the list."
          : `Emailed the first ${res.notified} drivers on the list.`,
      );
      setNotifyOpen(false);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send.");
    }
  }

  async function handlePromote(entry: WaitlistEntry) {
    setPromotingId(entry.id);
    try {
      const res = await promote({ data: { entryId: entry.id } });
      if (!res.ok) throw new Error(res.error);
      toast.success(`${entry.full_name} is now an applicant — you'll find them under New.`);
      await refresh();
      onPromoted?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not promote.");
    } finally {
      setPromotingId(null);
    }
  }

  const statusTone = (s: string): "green" | "amber" =>
    s === "promoted" ? "green" : "amber";
  const statusLabel = (s: string) => (s === "waiting" ? "Waiting" : s === "notified" ? "Notified" : "Promoted");

  return (
    <div className="space-y-4">
      <SectionCard
        title="Cars Available"
        subtitle="Set how many cars are open right now. Zero turns the site into waitlist mode."
        icon={<Car className="w-4 h-4" strokeWidth={1.75} />}
        right={
          carsAvailable === null ? (
            <StatusPill tone="neutral">Not Set</StatusPill>
          ) : carsAvailable === 0 ? (
            <StatusPill tone="amber">Waitlist Mode</StatusPill>
          ) : (
            <StatusPill tone="green">
              {carsAvailable} {carsAvailable === 1 ? "Car" : "Cars"} Available
            </StatusPill>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder={carsAvailable === null ? "Not set" : String(carsAvailable)}
            value={countInput}
            onChange={(e) => setCountInput(e.target.value)}
            className="w-28 rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm text-[#111114] outline-none focus:border-[#C7C7CC]"
          />
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={saving}
            className="rounded-lg bg-[#D03020] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {carsAvailable !== null && (
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving}
              className="rounded-lg border border-[#EDEDF0] px-3 py-2 text-xs font-medium text-[#55555E] transition hover:bg-[#FAFAFB] disabled:opacity-50"
            >
              Clear
            </button>
          )}
          <div className="ml-auto text-xs text-[#9A9AA3]">
            {waitingCount} {waitingCount === 1 ? "driver" : "drivers"} waiting
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-[#9A9AA3]">
          While this is empty the site works exactly as before. When you save a number above zero
          the site shows a scarcity line; at zero the hero form collects waitlist signups instead of
          applications, and drivers are never told their position.
        </p>
      </SectionCard>

      <SectionCard
        title="Waitlist"
        subtitle="First joined is first served. Promote someone as soon as a car frees up."
        icon={<Hourglass className="w-4 h-4" strokeWidth={1.75} />}
        padded={false}
      >
        {entries === null ? (
          <div className="px-5 py-10 text-center text-[13px] text-[#9A9AA3]">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<Hourglass className="w-6 h-6" strokeWidth={1.75} />}
              title="No Drivers on the Waitlist"
              hint="When Cars Available is set to zero, the site collects waitlist signups here instead of applications."
            />
          </div>
        ) : (
          <AdminTableScroll>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#EDEDF0] text-left">
                  <th className="px-5 py-2.5"><MicroLabel>Position</MicroLabel></th>
                  <th className="px-5 py-2.5"><MicroLabel>Driver</MicroLabel></th>
                  <th className="px-5 py-2.5"><MicroLabel>Wants To Start</MicroLabel></th>
                  <th className="px-5 py-2.5"><MicroLabel>Status</MicroLabel></th>
                  <th className="px-5 py-2.5"><MicroLabel>Joined</MicroLabel></th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-[#EDEDF0] last:border-0 hover:bg-[#FAFAFB]">
                    <td className="px-5 py-3 text-[13px] font-semibold text-[#111114]">
                      {e.position ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="text-[13px] font-medium text-[#111114]">{e.full_name}</div>
                      <div className="text-[11px] text-[#9A9AA3]">
                        {e.email}
                        {e.phone ? ` · ${e.phone}` : ""}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#55555E]">
                      {e.pickup_date ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill tone={statusTone(e.status)}>{statusLabel(e.status)}</StatusPill>
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#55555E]">
                      {new Date(e.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {e.status !== "promoted" ? (
                        <button
                          type="button"
                          onClick={() => handlePromote(e)}
                          disabled={promotingId === e.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#EDEDF0] px-3 py-1.5 text-xs font-medium text-[#111114] transition hover:border-[#D03020] hover:bg-[#D03020] hover:text-white disabled:opacity-50"
                        >
                          <UserPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                          {promotingId === e.id ? "Promoting…" : "Promote To Applicant"}
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#9A9AA3]">
                          {e.promoted_application_id ? "In Drivers" : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
        )}
      </SectionCard>

      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MailCheck className="h-4 w-4 text-[#D03020]" strokeWidth={1.75} />
              A Car Just Opened Up
            </DialogTitle>
            <DialogDescription>
              Email the first drivers on the waitlist before the car is offered anywhere else. Each
              driver is marked as notified once their email goes out.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 py-2">
            <label className="text-[13px] text-[#55555E]">How many</label>
            <input
              type="number"
              min={1}
              max={50}
              inputMode="numeric"
              value={notifyCount}
              onChange={(e) => setNotifyCount(e.target.value)}
              className="w-20 rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm outline-none focus:border-[#C7C7CC]"
            />
            <span className="text-[13px] text-[#9A9AA3]">
              of {waitingCount} waiting
            </span>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setNotifyOpen(false)}
              className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-xs font-medium text-[#55555E] hover:bg-[#FAFAFB]"
            >
              Not Now
            </button>
            <button
              type="button"
              onClick={handleNotify}
              className="rounded-lg bg-[#D03020] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
            >
              Email Them
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
