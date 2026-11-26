import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Paperclip, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LinkedVehicleCell } from "./VehicleCell";
import { StatusPill, EmptyState } from "./ui";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, inputCls } from "./modal";
import { fmtDate, fmtDateTime } from "@/lib/date-format";
import type { StaffTier } from "@/lib/roles";
import {
  COLLECTION_REASONS,
  COLLECTION_REASON_LABEL,
  COLLECTION_STATUSES,
  COLLECTION_STATUS_LABEL,
  COLLECTION_STATUS_TONE,
  collectionAttachmentPath,
  collectionBalance,
  collectionReasonLabel,
  collectionStatusLabel,
  collectionsTotal,
  isOpenCollectionStatus,
  prorationMath,
  type CollectionReason,
  type CollectionStatus,
  type StoredProration,
} from "@/lib/collections";
import {
  addCollectionAttachment,
  addCollectionItem,
  collectionAttachmentUrl,
  listCollections,
  recordRepossession,
  setCollectionItemStatus,
  updateCollectionItem,
  type CollectionAttachmentRow,
  type CollectionEventRow,
  type CollectionItemRow,
  type CollectionRentalRow,
} from "@/lib/collections.functions";

const usd = (v: number) => `$${v.toFixed(2)}`;
type Data = Awaited<ReturnType<typeof listCollections>>;
type Group = { key: string; applicationId: string; rental: CollectionRentalRow | null; vehicleId: string | null; items: CollectionItemRow[] };

/**
 * Payments > Collections: money still owed after a rental ended (repossessed, or returned with a
 * balance). One line per debt with its reason, status, notes, attachments and full history.
 * Not part of Overdue or Outstanding, and never texted or emailed automatically.
 * Manager/Owner edit; everything is logged with the date and the user.
 */
export function CollectionsPanel({ tier, focusItemId = null, onChanged, applicationId = null }: { tier: StaffTier | null; focusItemId?: string | null; onChanged?: () => void; applicationId?: string | null }) {
  const canEdit = tier === "owner" || tier === "manager";
  const navigate = useNavigate();
  const load = useServerFn(listCollections);
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [show, setShow] = useState<"owed" | "all">("owed");
  const [addFor, setAddFor] = useState<Group | null>(null);
  const [repoFor, setRepoFor] = useState<CollectionRentalRow | null>(null);
  const [editItem, setEditItem] = useState<CollectionItemRow | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusItemId ? [focusItemId] : []));

  const refresh = useCallback(() => {
    load({ data: { applicationId } })
      .then((d) => { setData(d); setFailed(false); })
      .catch(() => setFailed(true));
  }, [load, applicationId]);
  useEffect(refresh, [refresh]);
  const changed = () => { refresh(); onChanged?.(); };

  useEffect(() => {
    if (!focusItemId || !data) return;
    document.getElementById(`collection-item-${focusItemId}`)?.scrollIntoView({ block: "center" });
  }, [focusItemId, data]);

  const groups = useMemo<Group[]>(() => {
    if (!data) return [];
    const rentals = new Map(data.rentals.map((r) => [r.id, r]));
    const map = new Map<string, Group>();
    for (const it of data.items) {
      if (show === "owed" && !isOpenCollectionStatus(it.status) && it.id !== focusItemId) continue;
      const key = `${it.application_id}:${it.rental_id ?? "none"}`;
      const g = map.get(key) ?? { key, applicationId: it.application_id, rental: it.rental_id ? rentals.get(it.rental_id) ?? null : null, vehicleId: it.vehicle_id, items: [] };
      g.vehicleId = g.vehicleId ?? it.vehicle_id;
      g.items.push(it);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => collectionsTotal(b.items) - collectionsTotal(a.items));
  }, [data, show, focusItemId]);

  if (failed) return <p className="text-sm text-[#D03020]" data-testid="collections-error">Could not load Collections.</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading Collections…</p>;
  const total = collectionsTotal(data.items);
  const eventsBy = groupBy(data.events, (e) => e.item_id);
  const filesBy = groupBy(data.attachments, (a) => a.item_id);

  return (
    <div className="space-y-4" data-testid="collections-panel">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#EDEDF0] bg-white px-4 py-3">
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground">Total In Collections</div>
          <div className="text-[18px] font-semibold tabular-nums text-[#D03020]" data-testid="collections-total">{usd(total)}</div>
        </div>
        <p className="max-w-xl text-xs text-muted-foreground">
          Debts from rentals that ended with money owed. Kept out of Overdue and Outstanding, no late fees, and no automatic texts or emails. Payments that come in later apply here automatically.
        </p>
        <div className="ml-auto">
          <Select value={show} onValueChange={(v) => setShow(v as "owed" | "all")}>
            <SelectTrigger aria-label="Collections View" className="h-8 w-40 bg-white text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="owed">Still Owed</SelectItem>
              <SelectItem value="all">All Lines</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState title={show === "owed" ? "Nothing In Collections" : "No Collections Lines Yet"} hint="When a rental ends with a balance or a car is repossessed, its open charges move here." />
      ) : null}

      {groups.map((g) => {
        const name = data.names[g.applicationId] ?? "Renter";
        const r = g.rental;
        return (
          <section key={g.key} className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm" data-testid="collections-group">
            <header className="flex flex-wrap items-center gap-3 border-b border-[#EDEDF0] px-4 py-3">
              <button type="button" className="text-left text-sm font-semibold text-[#111114] hover:underline" onClick={() => navigate({ to: "/admin", search: { tab: "drivers", id: g.applicationId } as never })}>
                {name}
              </button>
              {g.vehicleId ? <LinkedVehicleCell vehicleId={g.vehicleId} size="sm" /> : null}
              {r ? (
                <span className="text-xs text-[#55555E]" data-testid="collections-rental-facts">
                  {r.close_reason === "repossessed" ? "Repossessed" : r.status === "closed" ? "Ended" : formatTitle(r.status)}
                  {r.end_date ? ` ${fmtDate(r.end_date)}` : ""}
                  {r.repossessed_on ? ` · Repo Date ${fmtDate(r.repossessed_on)} · ${r.days_late_at_repo ?? 0} Day${r.days_late_at_repo === 1 ? "" : "s"} Late` : ""}
                </span>
              ) : null}
              <span className="ml-auto text-sm font-semibold tabular-nums text-[#D03020]">{usd(collectionsTotal(g.items))}</span>
              {canEdit && r && r.status !== "active" ? (
                <button type="button" className="rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium" onClick={() => setRepoFor(r)} data-testid="collections-repo-button">
                  {r.repossessed_on ? "Edit Repo Date" : "Record Repo Date"}
                </button>
              ) : null}
              {canEdit ? (
                <button type="button" className="inline-flex items-center gap-1 rounded-md bg-[#D03020] px-2.5 py-1 text-xs font-medium text-white" onClick={() => setAddFor(g)} data-testid="collections-add-charge">
                  <Plus className="h-3.5 w-3.5" /> Add Charge
                </button>
              ) : null}
            </header>
            <ul>
              {g.items.map((it) => {
                const isOpen = open.has(it.id);
                const math = prorationMath(it.proration as StoredProration | null);
                const files = filesBy.get(it.id) ?? [];
                return (
                  <li key={it.id} id={`collection-item-${it.id}`} className={`border-t border-[#EDEDF0] px-4 py-3 first:border-t-0 ${focusItemId === it.id ? "bg-[#FFF7F5]" : ""}`} data-testid="collections-item">
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 lg:grid-cols-[auto_minmax(0,1.4fr)_repeat(3,minmax(0,0.6fr))_auto]">
                      <button type="button" aria-label={isOpen ? "Hide History" : "Show History"} className="mt-0.5 text-muted-foreground" onClick={() => setOpen((s) => toggle(s, it.id))}>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-[#111114]">{collectionReasonLabel(it.reason)}{it.description ? <span className="font-normal text-[#55555E]"> · {it.description}</span> : null}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {it.week_start ? `Week Of ${fmtDate(it.week_start)}` : it.incurred_on ? fmtDate(it.incurred_on) : fmtDate(it.created_at)}
                          {it.stripe_invoice_id ? " · Stripe Invoice Open" : ""}
                          {files.length ? <span className="ml-1 inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{files.length}</span> : null}
                        </div>
                        {math ? <div className="mt-0.5 text-[11px] font-medium text-[#55555E]" data-testid="collections-proration">Prorated: {math}</div> : null}
                        {it.notes ? <div className="mt-0.5 whitespace-pre-wrap text-[11px] text-[#55555E]">{it.notes}</div> : null}
                      </div>
                      <Money label="Amount" value={it.amount} />
                      <Money label="Paid" value={it.amount_paid} />
                      <Money label="Balance" value={collectionBalance(it)} strong />
                      <div className="flex items-center gap-2">
                        {canEdit ? (
                          <StatusSelect item={it} onDone={changed} />
                        ) : (
                          <StatusPill tone={COLLECTION_STATUS_TONE[it.status as CollectionStatus] ?? "neutral"}>{collectionStatusLabel(it.status)}</StatusPill>
                        )}
                        {canEdit ? <button type="button" className="rounded-md border border-border bg-white px-2 py-1 text-xs" onClick={() => setEditItem(it)}>Edit</button> : null}
                      </div>
                    </div>
                    {isOpen ? <ItemDetail item={it} events={eventsBy.get(it.id) ?? []} files={files} canEdit={canEdit} onDone={changed} /> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {addFor ? <AddChargeDialog group={addFor} onClose={() => setAddFor(null)} onDone={() => { setAddFor(null); changed(); }} /> : null}
      {repoFor ? <RepoDateDialog rental={repoFor} onClose={() => setRepoFor(null)} onDone={() => { setRepoFor(null); changed(); }} /> : null}
      {editItem ? <EditItemDialog item={editItem} onClose={() => setEditItem(null)} onDone={() => { setEditItem(null); changed(); }} /> : null}
    </div>
  );
}

function Money({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="hidden text-right lg:block">
      <div className="text-[10px] font-semibold text-muted-foreground">{label}</div>
      <div className={`text-[13px] tabular-nums ${strong ? "font-semibold text-[#111114]" : "text-[#55555E]"}`}>{usd(value)}</div>
    </div>
  );
}

function StatusSelect({ item, onDone }: { item: CollectionItemRow; onDone: () => void }) {
  const save = useServerFn(setCollectionItemStatus);
  return (
    <Select
      value={item.status}
      onValueChange={async (to) => {
        const note = window.prompt(`Change to ${COLLECTION_STATUS_LABEL[to as CollectionStatus]}? Add a note (saved in the history):`, "");
        if (note === null) return;
        const res = await save({ data: { itemId: item.id, to: to as CollectionStatus, expected: item.status as CollectionStatus, note: note.trim() || null } }).catch(() => ({ error: "Could not reach the server." }));
        if ("error" in res) return void toast.error(res.error);
        toast.success(`${COLLECTION_STATUS_LABEL[to as CollectionStatus]}: Saved`);
        onDone();
      }}
    >
      <SelectTrigger aria-label="Collections Status" className="h-7 w-auto border-0 bg-transparent p-0 shadow-none [&>svg]:hidden">
        <StatusPill tone={COLLECTION_STATUS_TONE[item.status as CollectionStatus] ?? "neutral"} caret>{collectionStatusLabel(item.status)}</StatusPill>
      </SelectTrigger>
      <SelectContent align="end">
        {COLLECTION_STATUSES.map((s) => (
          <SelectItem key={s} value={s} className="text-[13px]">{COLLECTION_STATUS_LABEL[s]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ItemDetail({ item, events, files, canEdit, onDone }: { item: CollectionItemRow; events: CollectionEventRow[]; files: CollectionAttachmentRow[]; canEdit: boolean; onDone: () => void }) {
  const record = useServerFn(addCollectionAttachment);
  const signed = useServerFn(collectionAttachmentUrl);
  return (
    <div className="mt-3 grid gap-4 pl-7 lg:grid-cols-2">
      <div>
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">History</div>
        <ol className="space-y-1" data-testid="collections-history">
          {events.map((e) => (
            <li key={e.id} className="text-[12px] text-[#55555E]">
              <span className="tabular-nums">{fmtDateTime(e.created_at)}</span> · {eventLabel(e)}
              {e.note ? <span className="text-muted-foreground"> · {e.note}</span> : null}
              <span className="text-muted-foreground"> · {e.actor_label ?? "System"}</span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Attachments</div>
        <ul className="mb-2 space-y-1">
          {files.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="text-[12px] text-[#D03020] hover:underline"
                onClick={async () => {
                  const res = await signed({ data: { attachmentId: f.id } }).catch(() => ({ error: "Could not open the file." }));
                  if ("error" in res) return void toast.error(res.error);
                  window.open(res.url, "_blank", "noopener");
                }}
              >
                {f.file_name ?? "File"}
              </button>
            </li>
          ))}
          {files.length === 0 ? <li className="text-[12px] text-muted-foreground">No receipts, photos or invoices yet.</li> : null}
        </ul>
        {canEdit ? (
          <FileUploader
            variant="inline"
            label="Attach Receipt, Photo Or Invoice"
            context={`Collections · ${collectionReasonLabel(item.reason)}`}
            accept="image/*,application/pdf"
            multiple
            maxBytes={15 * 1024 * 1024}
            autoStart
            upload={async (file) => {
              const path = collectionAttachmentPath(item.id, file.name);
              const up = await supabase.storage.from("receipts").upload(path, file, { contentType: file.type || undefined, upsert: false });
              if (up.error) throw new Error("Upload failed");
              const res = await record({ data: { itemId: item.id, path, fileName: file.name, mimeType: file.type || null } });
              if ("error" in res) throw new Error(res.error);
            }}
            onSettled={onDone}
          />
        ) : null}
      </div>
    </div>
  );
}

function eventLabel(e: CollectionEventRow): string {
  const money = e.amount == null ? "" : ` ${usd(e.amount)}`;
  switch (e.kind) {
    case "created": return `Added${money}`;
    case "status_changed": return `${collectionStatusLabel(e.from_status)} → ${collectionStatusLabel(e.to_status)}`;
    case "amount_changed": return "Amount Changed";
    case "prorated": return `Prorated To${money}`;
    case "payment_applied": return `Payment Applied${money}`;
    case "attachment_added": return "Attachment Added";
    default: return "Note";
  }
}

function AddChargeDialog({ group, onClose, onDone }: { group: Group; onClose: () => void; onDone: () => void }) {
  const add = useServerFn(addCollectionItem);
  const [reason, setReason] = useState<CollectionReason>("damage");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [incurredOn, setIncurredOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ModalShell onClose={onClose} label="Add Charge To Collections">
      <ModalHeader title="Add Charge To Collections" subtitle="Owed by this renter. Not texted or emailed; attach a receipt after saving." onClose={onClose} />
      <ModalBody>
        <div className="space-y-3">
          <label className="block text-xs">Reason
            <Select value={reason} onValueChange={(v) => setReason(v as CollectionReason)}>
              <SelectTrigger aria-label="Reason" className="mt-1.5 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COLLECTION_REASONS.map((r) => <SelectItem key={r} value={r}>{COLLECTION_REASON_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="block text-xs">Amount ($)<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} mt-1.5`} /></label>
          <label className="block text-xs">Description<input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Rear Bumper Repair" className={`${inputCls} mt-1.5`} /></label>
          <label className="block text-xs">Date<input type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} className={`${inputCls} mt-1.5`} /></label>
          <label className="block text-xs">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inputCls} mt-1.5`} /></label>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton
          variant="primary"
          disabled={busy || !(Number(amount) > 0)}
          onClick={async () => {
            setBusy(true);
            const res = await add({ data: { applicationId: group.applicationId, rentalId: group.rental?.id ?? null, reason, amount: Number(amount), description: description.trim() || null, incurredOn: incurredOn || null, notes: notes.trim() || null } })
              .catch(() => ({ error: "Could not reach the server." }));
            setBusy(false);
            if ("error" in res) return void toast.error(res.error);
            toast.success("Charge Added");
            onDone();
          }}
        >
          Add Charge
        </ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

function RepoDateDialog({ rental, onClose, onDone }: { rental: CollectionRentalRow; onClose: () => void; onDone: () => void }) {
  const save = useServerFn(recordRepossession);
  const [date, setDate] = useState(rental.repossessed_on ?? rental.end_date ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ModalShell onClose={onClose} label="Repo Date">
      <ModalHeader title={rental.repossessed_on ? "Edit Repo Date" : "Record Repo Date"} subtitle="The day the car was secured." onClose={onClose} />
      <ModalBody>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            The missed week's rent becomes the weekly rate ÷ 7 × the days the renter still had the car, from the start of that week through this date. Late fees, keys, damage and other charges stay in full. Changing the date recalculates.
          </p>
          <label className="block text-xs">Repo Date<input type="date" value={date} min={rental.start_date ?? undefined} onChange={(e) => setDate(e.target.value)} className={`${inputCls} mt-1.5`} /></label>
          <label className="block text-xs">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="How it was confirmed (GPS, pickup)" className={`${inputCls} mt-1.5`} /></label>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton
          variant="primary"
          disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(date)}
          onClick={async () => {
            setBusy(true);
            const res = await save({ data: { rentalId: rental.id, repoDate: date, note: note.trim() || null } }).catch(() => ({ error: "Could not reach the server." }));
            setBusy(false);
            if ("error" in res) return void toast.error(res.error);
            toast.success(`Repo Date Saved · ${res.daysLate} Day${res.daysLate === 1 ? "" : "s"} Late`);
            onDone();
          }}
        >
          Save
        </ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

function EditItemDialog({ item, onClose, onDone }: { item: CollectionItemRow; onClose: () => void; onDone: () => void }) {
  const save = useServerFn(updateCollectionItem);
  const [amount, setAmount] = useState(String(item.amount));
  const [reason, setReason] = useState<CollectionReason>((item.reason as CollectionReason) ?? "other");
  const [description, setDescription] = useState(item.description ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <ModalShell onClose={onClose} label="Edit Collections Line">
      <ModalHeader title="Edit Collections Line" subtitle={item.proration ? "Changing the amount by hand replaces the repo proration." : undefined} onClose={onClose} />
      <ModalBody>
        <div className="space-y-3">
          <label className="block text-xs">Reason
            <Select value={reason} onValueChange={(v) => setReason(v as CollectionReason)}>
              <SelectTrigger aria-label="Reason" className="mt-1.5 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COLLECTION_REASONS.map((r) => <SelectItem key={r} value={r}>{COLLECTION_REASON_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="block text-xs">Amount ($)<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} mt-1.5`} /></label>
          <label className="block text-xs">Description<input value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} mt-1.5`} /></label>
          <label className="block text-xs">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inputCls} mt-1.5`} /></label>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton
          variant="primary"
          disabled={busy || !(Number(amount) >= 0) || amount === ""}
          onClick={async () => {
            setBusy(true);
            const amt = Number(amount);
            const res = await save({ data: { itemId: item.id, amount: Math.abs(amt - item.amount) < 0.005 ? null : amt, reason: reason === item.reason ? null : reason, description: description.trim() === (item.description ?? "") ? null : description.trim(), notes: notes.trim() === (item.notes ?? "") ? null : notes.trim() } })
              .catch(() => ({ error: "Could not reach the server." }));
            setBusy(false);
            if ("error" in res) return void toast.error(res.error);
            toast.success("Saved");
            onDone();
          }}
        >
          Save
        </ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
  return m;
}
function toggle(s: Set<string>, id: string): Set<string> {
  const n = new Set(s);
  if (n.has(id)) n.delete(id); else n.add(id);
  return n;
}
function formatTitle(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
