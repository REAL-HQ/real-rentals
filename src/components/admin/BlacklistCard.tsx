import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Ban, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BLACKLISTED_BADGE,
  BLACKLISTED_LABEL,
  BLACKLIST_REASONS,
  STRIKE_KINDS,
  blacklistBlockers,
  formatBlacklistDate,
  identifierKindLabel,
  secondStrikeReached,
  strikeBlockers,
  type StrikeKind,
} from "@/lib/blacklist";
import {
  addToBlacklist,
  getBlacklistProfile,
  logRenterStrike,
  removeFromBlacklist,
  voidRenterStrike,
} from "@/lib/blacklist.functions";
import type { BlacklistEntry, BlacklistProfile } from "@/lib/blacklist";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The pastel red Blacklisted pill (same colours as the Unqualified badge). */
export function BlacklistedBadge({ title }: { title?: string | null }) {
  return (
    <span
      data-testid="blacklisted-badge"
      title={title ?? undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BLACKLISTED_BADGE}`}
    >
      <Ban className="h-3 w-3" /> {BLACKLISTED_LABEL}
    </span>
  );
}

/**
 * Driver profile: Blacklist status, warnings (strikes) and history.
 * Owner: Add To Blacklist / Remove From Blacklist / Void Warning.
 * Any staff: Log Warning. Every reason note is also added to the renter's Notes.
 */
export function BlacklistCard({
  applicationId,
  driverName,
  isOwner,
  onNotesChanged,
  onBlacklistChanged,
}: {
  applicationId: string;
  driverName: string | null;
  isOwner: boolean;
  onNotesChanged?: (notes: string) => void;
  onBlacklistChanged?: (entry: BlacklistEntry | null) => void;
}) {
  const load = useServerFn(getBlacklistProfile);
  const add = useServerFn(addToBlacklist);
  const remove = useServerFn(removeFromBlacklist);
  const strike = useServerFn(logRenterStrike);
  const voidStrike = useServerFn(voidRenterStrike);
  const [profile, setProfile] = useState<BlacklistProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<null | "add" | "remove" | "strike" | { voidId: string }>(null);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<StrikeKind | "">("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayEt());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    load({ data: { applicationId } })
      .then((p) => {
        setProfile(p);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [applicationId, load]);
  useEffect(() => refresh(), [refresh]);

  const open = (d: typeof dialog) => {
    setReason("");
    setKind("");
    setNote("");
    setDate(todayEt());
    setDialog(d);
  };

  if (failed) return null;
  if (!profile) return null;
  if (!profile.installed) return null;

  const active = profile.active;
  const liveStrikes = profile.strikes.filter((s) => !s.voidedAt);
  const strikeRows = profile.strikes.map((s) => ({ kind: s.kind, occurred_on: s.occurredOn, voided_at: s.voidedAt }));
  const addBlockers = blacklistBlockers({ reason, note, date }, strikeRows, todayEt());
  const strikeIssues = strikeBlockers({ kind, note, date }, todayEt());
  const eligibleKinds = STRIKE_KINDS.filter((k) => secondStrikeReached(strikeRows, k.key));

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setDialog(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="blacklist-card"
      className={`rounded-xl border p-4 ${active ? "border-rose-200 bg-rose-50" : "border-[#EDEDF0] bg-white"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert className={`h-4 w-4 ${active ? "text-rose-800" : "text-[#9A9AA3]"}`} />
        <h3 className="text-[13px] font-semibold text-[#111114]">Blacklist And Warnings</h3>
        {active ? <BlacklistedBadge title={active.reasonLabel} /> : null}
        {!active && liveStrikes.length ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {liveStrikes.length} Warning{liveStrikes.length === 1 ? "" : "s"}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={secondary} onClick={() => open("strike")} data-testid="blacklist-log-warning">
            Log Warning
          </button>
          {isOwner && !active ? (
            <button type="button" className={primary} onClick={() => open("add")} data-testid="blacklist-add">
              <Ban className="h-3.5 w-3.5" /> Add To Blacklist
            </button>
          ) : null}
          {isOwner && active ? (
            <button type="button" className={secondary} onClick={() => open("remove")} data-testid="blacklist-remove">
              Remove From Blacklist
            </button>
          ) : null}
        </div>
      </div>

      {active ? (
        <dl className="mt-3 grid gap-1 text-[12px] text-[#3A3A42] sm:grid-cols-[140px_minmax(0,1fr)]">
          <dt className="text-[#9A9AA3]">Reason</dt>
          <dd>{active.reasonLabel}</dd>
          <dt className="text-[#9A9AA3]">Note</dt>
          <dd className="whitespace-pre-wrap">{active.note}</dd>
          <dt className="text-[#9A9AA3]">Date</dt>
          <dd>{formatBlacklistDate(active.blacklistedOn)}</dd>
          <dt className="text-[#9A9AA3]">Added By</dt>
          <dd>{active.addedBy}</dd>
        </dl>
      ) : (
        <p className="mt-2 text-[12px] text-[#55555E]">
          Not Blacklisted. Any one serious reason blacklists; Late Payment, Smoking and Returning The Car Dirty need a
          logged warning first.
        </p>
      )}

      {profile.matches.length ? (
        <p className="mt-2 text-[12px] font-medium text-rose-800" data-testid="blacklist-matches">
          Matches A Blacklisted Renter On:{" "}
          {[...new Set(profile.matches.flatMap((m) => m.kinds))].map(identifierKindLabel).join(", ")}. Never
          auto-approved; an Owner must confirm it is not the same person.
        </p>
      ) : null}

      {profile.strikes.length ? (
        <ul className="mt-3 space-y-1.5 text-[12px]">
          {profile.strikes.map((s) => (
            <li key={s.id} className={`flex flex-wrap items-baseline gap-2 ${s.voidedAt ? "text-[#9A9AA3] line-through" : "text-[#3A3A42]"}`}>
              <span className="font-medium">{s.kindLabel}</span>
              <span>{formatBlacklistDate(s.occurredOn)}</span>
              <span className="min-w-0 flex-1">{s.note}</span>
              <span className="text-[#9A9AA3]">{s.addedBy}</span>
              {isOwner && !s.voidedAt ? (
                <button type="button" className="text-[11px] underline" onClick={() => open({ voidId: s.id })}>
                  Void
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {eligibleKinds.length && !active ? (
        <p className="mt-2 text-[12px] font-medium text-amber-800">
          Second Strike Reached: {eligibleKinds.map((k) => k.label).join(", ")}. Eligible For Blacklist.
        </p>
      ) : null}

      {profile.history.filter((h) => h.removedAt).length ? (
        <details className="mt-3 text-[12px] text-[#55555E]">
          <summary className="cursor-pointer">Blacklist History</summary>
          <ul className="mt-1 space-y-1">
            {profile.history.map((h) => (
              <li key={h.id}>
                {formatBlacklistDate(h.blacklistedOn)} · {h.reasonLabel} · Added By {h.addedBy}
                {h.removedAt ? ` · Removed By ${h.removedBy}: ${h.removalReason}` : " · Active"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Dialog open={dialog === "add"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Add To Blacklist: {driverName ?? "Renter"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#55555E]">
            They can never be approved, reserved or rented to again. New applications with the same phone, email, license
            number or address go to Needs Staff. The note is also saved to their Notes.
          </p>
          <label className="mt-2 block text-xs font-medium text-muted-foreground">Reason</label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="bg-white" data-testid="blacklist-reason">
              <SelectValue placeholder="Pick A Reason" />
            </SelectTrigger>
            <SelectContent className="bg-white">
              {BLACKLIST_REASONS.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="mt-2 block text-xs font-medium text-muted-foreground">Reason Note</label>
          <textarea className={input} rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="blacklist-note" />
          <label className="mt-2 block text-xs font-medium text-muted-foreground">Date</label>
          <input type="date" className={input} value={date} max={todayEt()} onChange={(e) => setDate(e.target.value)} />
          {reason && addBlockers.length ? (
            <p className="text-[12px] text-[#D03020]">{addBlockers.map((b) => b.why).join(" ")}</p>
          ) : null}
          <DialogFooter>
            <button type="button" className={secondary} onClick={() => setDialog(null)}>Cancel</button>
            <button
              type="button"
              className={primary}
              disabled={busy || addBlockers.length > 0}
              onClick={() =>
                void run(async () => {
                  const r = await add({ data: { applicationId, reason: reason as any, note, date } });
                  onNotesChanged?.(r.notes);
                  onBlacklistChanged?.(r.entry);
                }, "Added To Blacklist")
              }
            >
              Add To Blacklist
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "remove"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Remove From Blacklist: {driverName ?? "Renter"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#55555E]">The entry is kept in history with who removed it, when and why.</p>
          <label className="mt-2 block text-xs font-medium text-muted-foreground">Why</label>
          <textarea className={input} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <button type="button" className={secondary} onClick={() => setDialog(null)}>Cancel</button>
            <button
              type="button"
              className={primary}
              disabled={busy || note.trim().length < 5}
              onClick={() =>
                void run(async () => {
                  const r = await remove({ data: { applicationId, reason: note } });
                  onNotesChanged?.(r.notes);
                  onBlacklistChanged?.(null);
                }, "Removed From Blacklist")
              }
            >
              Remove From Blacklist
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "strike"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Log Warning: {driverName ?? "Renter"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#55555E]">
            First strike is a warning. A second strike (two Late Payments within 60 days) makes them eligible for the
            blacklist. The note is also saved to their Notes.
          </p>
          <label className="mt-2 block text-xs font-medium text-muted-foreground">Warning For</label>
          <Select value={kind} onValueChange={(v) => setKind(v as StrikeKind)}>
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Pick One" />
            </SelectTrigger>
            <SelectContent className="bg-white">
              {STRIKE_KINDS.map((k) => (
                <SelectItem key={k.key} value={k.key}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="mt-2 block text-xs font-medium text-muted-foreground">Note</label>
          <textarea className={input} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="mt-2 block text-xs font-medium text-muted-foreground">Date It Happened</label>
          <input type="date" className={input} value={date} max={todayEt()} onChange={(e) => setDate(e.target.value)} />
          <DialogFooter>
            <button type="button" className={secondary} onClick={() => setDialog(null)}>Cancel</button>
            <button
              type="button"
              className={primary}
              disabled={busy || strikeIssues.length > 0}
              onClick={() =>
                void run(async () => {
                  const r = await strike({ data: { applicationId, kind: kind as StrikeKind, note, date } });
                  onNotesChanged?.(r.notes);
                  if (r.secondStrike) toast.message("Second Strike Reached. Eligible For Blacklist.");
                }, "Warning Logged")
              }
            >
              Log Warning
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={typeof dialog === "object" && dialog !== null} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Void Warning</DialogTitle>
          </DialogHeader>
          <label className="mt-2 block text-xs font-medium text-muted-foreground">Why</label>
          <textarea className={input} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <button type="button" className={secondary} onClick={() => setDialog(null)}>Cancel</button>
            <button
              type="button"
              className={primary}
              disabled={busy || note.trim().length < 5}
              onClick={() =>
                void run(async () => {
                  if (typeof dialog === "object" && dialog) await voidStrike({ data: { strikeId: dialog.voidId, reason: note } });
                }, "Warning Voided")
              }
            >
              Void Warning
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
