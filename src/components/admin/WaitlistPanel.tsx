import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Car, Hourglass, MailCheck, ShieldAlert, UserPlus } from "lucide-react";
import { WaitlistConflictDialog } from "./WaitlistConflictDialog";
import {
  listWaitlist,
  setCarsAvailable,
  notifyWaitlistTop,
  promoteToApplicant,
  type WaitlistEntry,
} from "@/lib/waitlist.functions";
import { AdminTableScroll } from "./AdminTableScroll";
import { EmptyState, MicroLabel, ReadinessCell, SectionCard, StatusPill } from "./ui";
import type { FleetAvailability } from "@/lib/waitlist.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtDate } from "@/lib/date-format";
import { APPLICATION_RESUME_ENABLED } from "@/lib/application-resume-flag";
import { WAITLIST_AGING_ENABLED, failedWaitlistAging, type WaitlistAgingResult } from "@/lib/waitlist-aging";
import { getWaitlistAging } from "@/lib/waitlist-aging.functions";
import { WaitlistAging } from "./WaitlistAging";

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
  const loadAging = useServerFn(getWaitlistAging);
  const [aging, setAging] = useState<WaitlistAgingResult | null>(null);

  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);
  const [carsAvailable, setCarsAvailableState] = useState<number | null>(null);
  const [fleet, setFleet] = useState<FleetAvailability | null>(null);
  const [countInput, setCountInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyCount, setNotifyCount] = useState("5");
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set());
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [resumeLink, setResumeLink] = useState<{ href: string; name: string } | null>(null);

  const refresh = useCallback(async () => {
    setFleet(null); // Never leave a previous successful count visible after a failed refresh.
    setEntries(null); // Unknown readiness is not the last successful screening result.
    const r = await list();
    setEntries(r.entries);
    setCarsAvailableState(r.carsAvailable);
    setFleet(r.fleet);
    onEntriesChange?.(r.entries.filter((e) => e.status !== "promoted").length);
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  useEffect(() => {
    refresh().catch((e) => toast.error(e?.message ?? "Could not load the waitlist."));
  }, [refresh]);

  useEffect(() => {
    if (WAITLIST_AGING_ENABLED !== true) return;
    let cancelled = false;
    loadAging()
      .then((result) => {
        if (!cancelled) setAging(result);
      })
      .catch(() => {
        if (!cancelled) setAging(failedWaitlistAging());
      });
    return () => {
      cancelled = true;
    };
  }, [loadAging]);

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
    setResumeLink(null);
    try {
      const res = await promote({ data: { entryId: entry.id } });
      if (!res.ok) {
        setResumeLink(null);
        if ("conflict" in res && res.conflict) {
          setConflictIds((s) => new Set(s).add(entry.id));
          toast.warning("Needs review: the email matches an existing driver but the phone differs. Use Review Conflict.");
          return;
        }
        throw new Error(res.error);
      }
      toast.success(`${entry.full_name} is now an applicant — you'll find them under New.`);
      if (APPLICATION_RESUME_ENABLED === true) {
        const { resumeLinkForPromotion } = await import("@/lib/application-resume");
        const link = resumeLinkForPromotion({ ok: res.ok, token: res.token, name: entry.full_name });
        setResumeLink(link?.href && link.name ? link : null);
      } else {
        setResumeLink(null);
      }
      await refresh();
      onPromoted?.();
    } catch (e: any) {
      setResumeLink(null);
      toast.error(e?.message ?? "Could not promote.");
    } finally {
      setPromotingId(null);
    }
  }

  const statusTone = (s: string): "green" | "amber" =>
    s === "promoted" ? "green" : "amber";
  const statusLabel = (s: string) => (s === "waiting" ? "Waiting" : s === "notified" ? "Notified" : "Promoted");

  async function copyResumeLink() {
    if (!resumeLink) return;
    try {
      await navigator.clipboard.writeText(resumeLink.href);
      toast.success("Link copied.");
    } catch {
      toast.error("Select the link and copy it.");
    }
  }

  return (
    <div className="space-y-4">
      {APPLICATION_RESUME_ENABLED === true && resumeLink?.href && resumeLink.name ? (
        <section className="rounded-xl border border-[#EDEDF0] bg-white px-5 py-4" aria-label={`Resume Link For ${resumeLink.name}`}>
          <div className="text-sm font-semibold text-[#111114]">Resume Link For {resumeLink.name}</div>
          <p className="mt-1 text-[13px] leading-snug text-[#55555E]">
            Promotion created this application for {resumeLink.name}. Copy this link and give it to them. This page does not send an email.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              readOnly
              aria-label={`Resume Link For ${resumeLink.name}`}
              value={resumeLink.href}
              className="min-h-11 w-full rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] px-3 text-sm text-[#111114]"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={() => void copyResumeLink()}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[#D03020] px-4 text-sm font-semibold text-white hover:opacity-90"
            >
              Copy Link
            </button>
          </div>
        </section>
      ) : null}
      <SectionCard
        title="Cars Available"
        subtitle="Fleet counts come from your vehicles. The public override is optional and only changes what the website shows."
        icon={<Car className="w-4 h-4" strokeWidth={1.75} />}
        right={
          carsAvailable === null ? (
            <StatusPill tone="neutral">Override Not Set</StatusPill>
          ) : carsAvailable === 0 ? (
            <StatusPill tone="amber">Waitlist Mode</StatusPill>
          ) : (
            <StatusPill tone="green">
              {carsAvailable} {carsAvailable === 1 ? "Car" : "Cars"} Available
            </StatusPill>
          )
        }
      >
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[#EDEDF0] px-4 py-3">
            <MicroLabel>Fleet Available</MicroLabel>
            <div className="mt-1 text-xl font-semibold tabular-nums text-[#111114]">{fleet ? fleet.fleetAvailable : "—"}</div>
            <div className="text-[11px] leading-snug text-[#9A9AA3]">Vehicles with status Available. Same count as Overview.</div>
          </div>
          <div className="rounded-xl border border-[#EDEDF0] px-4 py-3">
            <MicroLabel>Ready To Rent Now</MicroLabel>
            <div className="mt-1 text-xl font-semibold tabular-nums text-[#111114]">{fleet ? fleet.rentalReady : "—"}</div>
            <div className="text-[11px] leading-snug text-[#9A9AA3]">Available cars with no active rental, a passed pre-delivery inspection, and identity, VIN and rate complete. Registration and insurance expiry are not counted yet.</div>
          </div>
          <div className="rounded-xl border border-[#EDEDF0] px-4 py-3">
            <MicroLabel>Public Availability Override</MicroLabel>
            <div className="mt-1 text-xl font-semibold tabular-nums text-[#111114]">{carsAvailable === null ? "Not Set" : carsAvailable}</div>
            <div className="text-[11px] leading-snug text-[#9A9AA3]">Optional manual number the website uses for scarcity and waitlist mode.</div>
          </div>
        </div>
        <div className="mb-2"><MicroLabel>Set Public Override</MicroLabel></div>
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

      {WAITLIST_AGING_ENABLED === true ? <WaitlistAging result={aging} /> : null}

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
                  <th className="px-5 py-2.5"><MicroLabel>Readiness</MicroLabel></th>
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
                    <td className="px-5 py-3 whitespace-nowrap text-[13px] text-[#55555E]">
                      {e.pickup_date ? fmtDate(e.pickup_date) : "—"}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <ReadinessCell
                        notStarted={!e.readiness}
                        result={e.readiness?.result}
                        docCount={e.readiness?.docCount ?? 0}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill tone={statusTone(e.status)}>{statusLabel(e.status)}</StatusPill>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-[13px] text-[#55555E]">
                      {fmtDate(e.created_at)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {e.status !== "promoted" && (conflictIds.has(e.id) || e.review_reason === "email_match_phone_differs") ? (
                        <button
                          type="button"
                          onClick={() => setReviewId(e.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#D03020] px-3 py-1.5 text-xs font-medium text-[#D03020] transition hover:bg-[#D03020] hover:text-white"
                        >
                          <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
                          Review Conflict
                        </button>
                      ) : e.status !== "promoted" ? (
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

      <WaitlistConflictDialog
        entryId={reviewId}
        onClose={() => setReviewId(null)}
        onResolved={(_appId) => {
          const id = reviewId;
          if (id) setConflictIds((s) => { const n = new Set(s); n.delete(id); return n; });
          refresh().catch(() => {});
          onPromoted?.();
        }}
      />

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
