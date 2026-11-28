import { PhoneInput } from "@/components/ui/phone-input";
import { enumDisplayLabel, formatStatusLabel } from "@/lib/ui-display-labels";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Partner, FleetOwner, InvestorLead } from "./types";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { linkPartnerLogin } from "@/lib/partner.functions";
import { EmptyState } from "./ui";
import { fmtDateTime } from "@/lib/date-format";
import { OwnerVehiclePhotoGrid, OwnerVehiclePhotoThumb } from "./owner-vehicle-photos";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PARTNER_STATUSES = ["prospect","active","paused","closed"] as const;

/**
 * Lender groups the two capital-providing stored types.
 *
 * private_lender is labeled "Private Lender" — a lender by name.
 * capital_partner is labeled "Capital Partner". It is its own check-constraint
 * value, not an alias of private_lender. The only writer is Convert To Partner
 * on an investor lead, which stores a capital range. It is included because it
 * is the other money-in type beside private_lender (not a vehicle owner, not a
 * JV partner, and not other).
 *
 * The database still allows vehicle_owner, capital_partner, private_lender,
 * jv_partner, and other. Nothing here adds a value or rewrites a row.
 */
export const LENDER_PARTNER_TYPES = ["private_lender", "capital_partner"] as const;

export const PARTNER_FILTERS = [
  { id: "all", label: "All" },
  { id: "lender", label: "Lender" },
  { id: "jv_partner", label: "JV Partner" },
] as const;

export function isLenderPartnerType(partnerType: string | null | undefined): boolean {
  return partnerType === "private_lender" || partnerType === "capital_partner";
}

/** All matches every stored type, including ones outside Lender and JV Partner. */
export function partnerMatchesFilter(partnerType: string | null | undefined, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "lender") return isLenderPartnerType(partnerType);
  if (filter === "jv_partner") return partnerType === "jv_partner";
  return false;
}

export function partnerFilterCount(partners: { partner_type: string }[], filter: string): number {
  return partners.filter((p) => partnerMatchesFilter(p.partner_type, filter)).length;
}

/** Form choices. `stored` is the check-constraint value a new choice writes. */
export const PARTNER_FORM_TYPES = [
  { value: "lender", label: "Lender", stored: "private_lender" },
  { value: "jv_partner", label: "JV Partner", stored: "jv_partner" },
] as const;

/** Lender types share one option so the control can say "Lender" without a new stored value. */
export function partnerFormValue(stored: string | null | undefined): string {
  if (isLenderPartnerType(stored)) return "lender";
  if (stored === "jv_partner") return "jv_partner";
  return stored ?? "";
}

/**
 * Add and edit offer Lender and JV Partner.
 * A stored type outside those two stays as an extra selected option so the
 * control is not blank and opening it does not rewrite the row.
 */
export function partnerFormChoices(stored: string | null | undefined): { value: string; label: string }[] {
  const choices = PARTNER_FORM_TYPES.map((c) => ({ value: c.value, label: c.label }));
  if (!stored || isLenderPartnerType(stored) || stored === "jv_partner") return choices;
  return [{ value: stored, label: enumDisplayLabel(stored) }, ...choices];
}

/**
 * Stored type to write when staff pick a choice.
 * Null leaves the row unchanged — choosing Lender again on a capital_partner
 * must not turn it into private_lender.
 */
export function partnerTypeToStore(choice: string, current: string | null | undefined): string | null {
  if (choice === "lender") {
    if (isLenderPartnerType(current)) return null;
    return "private_lender";
  }
  if (choice === "jv_partner") {
    if (current === "jv_partner") return null;
    return "jv_partner";
  }
  if (current && choice === current) return null;
  return null;
}

export function PartnersPanel({
  externalSearch = "",
  preview,
}: {
  externalSearch?: string;
  /** Skip the server read and render these legacy rows. The detail test uses this. */
  preview?: {
    owners?: FleetOwner[];
    investors?: InvestorLead[];
    photoUrls?: Record<string, string>;
    expandedOwnerId?: string | null;
    /** Opens one legacy row's menu. The detail test uses this. */
    menuOwnerId?: string | null;
    /** Skip the partners read and render these rows. Filter tests use this. */
    partners?: Partner[];
    filter?: string;
    showAdd?: boolean;
    /** Opens the add-form type menu. The screenshot uses this. */
    typeMenuOpen?: boolean;
  };
} = {}) {
  const [partners, setPartners] = useState<Partner[]>(preview?.partners ?? []);
  const [legacyOwners, setLegacyOwners] = useState<FleetOwner[]>(preview?.owners ?? []);
  const [legacyInvestors, setLegacyInvestors] = useState<InvestorLead[]>(preview?.investors ?? []);
  const [openOwnerId, setOpenOwnerId] = useState<string | null>(preview?.expandedOwnerId ?? null);
  const [menuOwnerId, setMenuOwnerId] = useState<string | null>(preview?.menuOwnerId ?? null);
  const [deleteOwner, setDeleteOwner] = useState<FleetOwner | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState<string>(preview?.filter ?? "all");
  const [showAdd, setShowAdd] = useState(preview?.showAdd ?? false);

  function reloadLegacyOwners() {
    return supabase
      .from("fleet_owner_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          return;
        }
        setLegacyOwners(data || []);
      });
  }

  useEffect(() => {
    if (preview) return;
    refresh();
    void reloadLegacyOwners();
    supabase.from("investor_leads").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setLegacyInvestors(data || []));
  }, []);

  function refresh() {
    supabase.from("partners").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setPartners(data || []));
  }

  async function update(id: string, patch: Partial<Partner>) {
    const { error } = await supabase.from("partners").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    setPartners(p => p.map(x => x.id === id ? { ...x, ...patch } : x));
  }
  async function remove(id: string) {
    if (!confirm("Delete partner?")) return;
    const { error } = await supabase.from("partners").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setPartners(p => p.filter(x => x.id !== id));
  }
  async function add(p: Partial<Partner>) {
    const { data, error } = await supabase.from("partners").insert(p as any).select().single();
    if (error) return toast.error(error.message);
    setPartners(cur => [data as Partner, ...cur]);
    setShowAdd(false);
    toast.success("Partner added");
  }
  async function convertOwner(o: FleetOwner) {
    await add({ name: o.full_name, email: o.email, phone: o.phone, partner_type: "vehicle_owner", status: "prospect", vehicles_contributed: 1, notes: `Converted from fleet owner submission. Vehicle: ${o.year} ${o.make} ${o.model}` });
  }
  async function confirmDeleteOwner() {
    const owner = deleteOwner;
    if (!owner || deleting) return;
    setDeleting(true);
    const { data, error } = await supabase
      .from("fleet_owner_submissions")
      .delete()
      .eq("id", owner.id)
      .select("id");
    setDeleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data?.length) {
      toast.error("Could not delete this submission.");
      return;
    }
    toast.success("Submission Deleted");
    setDeleteOwner(null);
    if (openOwnerId === owner.id) setOpenOwnerId(null);
    setLegacyOwners((rows) => rows.filter((row) => row.id !== owner.id));
    if (preview) return;
    await reloadLegacyOwners();
  }
  async function convertInvestor(l: InvestorLead) {
    await add({ name: l.name, email: l.email, phone: l.phone || undefined, partner_type: "capital_partner", status: "prospect", notes: [l.capital_range && `Range: ${l.capital_range}`, l.message].filter(Boolean).join(" — ") || null });
  }

  const q = externalSearch.trim().toLowerCase();
  const filtered = partners.filter((p) => partnerMatchesFilter(p.partner_type, filter))
    .filter(p => {
      if (!q) return true;
      const hay = `${p.name ?? ""} ${p.email ?? ""} ${p.phone ?? ""} ${p.partner_type ?? ""}`.toLowerCase();
      return hay.includes(q);
    });

  return (
    <div>
      <div className="admin-sticky-bar flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap gap-2 text-xs" data-testid="partner-type-filters">
          {PARTNER_FILTERS.map((s) => (
            <button key={s.id} type="button" onClick={() => setFilter(s.id)}
              data-testid={`partner-filter-${s.id}`}
              className={`px-3 py-1.5 rounded-md ${filter === s.id ? "bg-black text-white" : "bg-white border border-border"}`}>
              {s.label}{s.id !== "all" && ` (${partnerFilterCount(partners, s.id)})`}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAdd(true)} className="ml-auto rounded-md bg-[#D03020] text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity duration-150">+ Add Partner</button>
      </div>

      <div className="space-y-2">
        {filtered.map(p => (
          <div key={p.id} className="rounded-xl bg-soft p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-[240px]">
                <div className="font-medium">{p.name} <span className="text-xs text-muted-foreground">· {enumDisplayLabel(p.partner_type)}</span></div>
                <div className="text-xs text-muted-foreground">{p.email || "—"} · {p.phone || "—"}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Capital: ${Number(p.capital_committed || 0).toLocaleString()} · Vehicles: {p.vehicles_contributed || 0} · Monthly: ${Number(p.monthly_payment || 0).toLocaleString()}
                </div>
              </div>
              <Select value={p.status} onValueChange={(status) => update(p.id, { status })}>
                <SelectTrigger className="h-8 w-28 bg-white text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent>{PARTNER_STATUSES.map(s => <SelectItem key={s} value={s}>{formatStatusLabel(s)}</SelectItem>)}</SelectContent>
              </Select>
              <PartnerTypeSelect
                stored={p.partner_type}
                onStored={(partner_type) => update(p.id, { partner_type })}
                triggerClassName="h-8 w-36 bg-white text-foreground"
              />
              <button onClick={() => remove(p.id)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-real-red hover:text-white hover:border-real-red">Delete</button>
            </div>
            <LinkLoginRow partner={p} onLinked={refresh} />
            <div className="grid grid-cols-3 gap-2 mt-3">
              <NumInput label="Capital ($)" value={p.capital_committed as any} onSave={(v) => update(p.id, { capital_committed: v })} />
              <NumInput label="Vehicles" value={p.vehicles_contributed as any} onSave={(v) => update(p.id, { vehicles_contributed: v })} />
              <NumInput label="Monthly ($)" value={p.monthly_payment as any} onSave={(v) => update(p.id, { monthly_payment: v })} />
            </div>
            <textarea defaultValue={p.notes || ""} onBlur={(e) => update(p.id, { notes: e.target.value })}
              placeholder="Notes" rows={2}
              className="mt-2 w-full bg-white border border-border rounded-md px-3 py-2 text-sm" />
          </div>
        ))}
        {filtered.length === 0 && <EmptyState title="No Partners" hint="Add a fleet partner to start assigning vehicles and tracking payouts." />}
      </div>

      <div className="mt-10">
        <h3 className="text-sm font-semibold tracking-wider text-muted-foreground mb-3">Legacy Submissions</h3>
        <div className="space-y-2">
          {legacyOwners.map(o => (
            <LegacyOwnerRow
              key={o.id}
              owner={o}
              open={openOwnerId === o.id}
              menuOpen={menuOwnerId === o.id}
              photoUrls={preview?.photoUrls}
              onToggle={() => setOpenOwnerId((current) => current === o.id ? null : o.id)}
              onConvert={() => convertOwner(o)}
              onMenuOpenChange={(next) => setMenuOwnerId(next ? o.id : null)}
              onDelete={() => {
                setMenuOwnerId(null);
                setDeleteOwner(o);
              }}
            />
          ))}
          {legacyInvestors.map(l => (
            <div key={l.id} className="rounded-lg bg-white border border-border p-3 flex flex-wrap items-center gap-3 text-sm">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium">{l.name} <span className="text-xs text-muted-foreground">· Investor</span></div>
                <div className="text-xs text-muted-foreground">{l.email} · {l.capital_range || "—"}</div>
              </div>
              <button onClick={() => convertInvestor(l)} className="rounded-md bg-black text-white px-3 py-1.5 text-xs">Convert To Partner</button>
            </div>
          ))}
          {legacyOwners.length === 0 && legacyInvestors.length === 0 && (
            <div className="text-xs text-muted-foreground">No Legacy Submissions</div>
          )}
        </div>
      </div>

      {showAdd && <AddPartner onClose={() => setShowAdd(false)} onSave={add} typeMenuOpen={preview?.typeMenuOpen} />}
      <LegacyDeleteDialog
        owner={deleteOwner}
        deleting={deleting}
        onCancel={() => {
          if (!deleting) setDeleteOwner(null);
        }}
        onConfirm={() => void confirmDeleteOwner()}
      />
    </div>
  );
}

/** Sentence shown before a legacy fleet-owner row is removed. */
export function legacySubmissionDeleteCopy(owner: Pick<FleetOwner, "full_name" | "year" | "make" | "model">) {
  const name = owner.full_name.trim() || "This Submitter";
  const vehicle = [owner.year, owner.make, owner.model]
    .filter((part) => part != null && String(part).trim() !== "")
    .join(" ");
  return {
    title: "Delete Submission?",
    body: `This removes ${name}'s ${vehicle || "vehicle"} submission. This can't be undone.`,
  };
}

function LegacyDeleteDialog({
  owner,
  deleting,
  onCancel,
  onConfirm,
}: {
  owner: FleetOwner | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = owner ? legacySubmissionDeleteCopy(owner) : null;
  return (
    <AlertDialog open={owner !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent data-testid="legacy-submission-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title ?? "Delete Submission?"}</AlertDialogTitle>
          <AlertDialogDescription>{copy?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-[#D03020] text-white hover:bg-[#B82818]"
            disabled={deleting}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LegacyOwnerRow({
  owner,
  open,
  menuOpen,
  photoUrls,
  onToggle,
  onConvert,
  onMenuOpenChange,
  onDelete,
}: {
  owner: FleetOwner;
  open: boolean;
  menuOpen: boolean;
  photoUrls?: Record<string, string>;
  onToggle: () => void;
  onConvert: () => void;
  onMenuOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  const photos = owner.photo_urls ?? [];
  const first = photos[0] ?? null;
  return (
    <div className="rounded-lg border border-border bg-white p-3 text-sm" data-testid="legacy-owner-row">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <OwnerVehiclePhotoThumb path={first} previewUrl={first ? photoUrls?.[first] : null} />
          <div className="min-w-[200px] flex-1">
            <div className="font-medium">{owner.full_name} <span className="text-xs text-muted-foreground">· Fleet Owner</span></div>
            <div className="text-xs text-muted-foreground">{owner.email} · {owner.year} {owner.make} {owner.model}</div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onConvert} className="rounded-md bg-black px-3 py-1.5 text-xs text-white">Convert To Partner</button>
          <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More Actions For ${owner.full_name}`}
                data-testid="legacy-submission-menu"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-soft hover:text-foreground"
              >
                <MoreVertical aria-hidden="true" className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 bg-white">
              <DropdownMenuItem
                data-testid="legacy-submission-delete"
                className="text-real-red focus:text-real-red"
                onSelect={() => onDelete()}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {open && (
        <div className="mt-3 border-t border-[#EDEDF0] pt-3" data-testid="legacy-owner-details">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
            <Detail label="Phone" value={owner.phone || "—"} />
            <Detail label="VIN" value={owner.vin || "—"} />
            <Detail label="Year" value={owner.year ? String(owner.year) : "—"} />
            <Detail label="Make" value={owner.make || "—"} />
            <Detail label="Model" value={owner.model || "—"} />
            <Detail label="Trim" value={owner.trim || "—"} />
            <Detail label="Mileage" value={owner.mileage == null ? "—" : `${owner.mileage.toLocaleString("en-US")} mi`} />
            <Detail label="Title Status" value={owner.title_status || "—"} />
            <Detail label="Lien Status" value={owner.lien_status || "—"} />
            <Detail label="Registration State" value={owner.registration_state || "—"} />
            <Detail label="Currently Insured" value={owner.currently_insured == null ? "—" : owner.currently_insured ? "Yes" : "No"} />
            <Detail label="Condition" value={owner.condition || "—"} />
            <Detail label="Status" value={formatStatusLabel(owner.status)} />
            <Detail label="Created" value={fmtDateTime(owner.created_at) || "—"} />
          </div>
          <div className="mt-3">
            <div className="text-[11px] font-semibold text-[#55555E]">Message</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[#111114]">{owner.message || "—"}</p>
          </div>
          <div className="mt-3">
            <div className="mb-2 text-[11px] font-semibold text-[#55555E]">Photos</div>
            {photos.length > 0 ? (
              <OwnerVehiclePhotoGrid paths={photos} previewUrls={photoUrls} />
            ) : (
              <p className="text-xs text-muted-foreground">No Photos</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-[#55555E]">{label}</div>
      <div className="mt-0.5 break-words text-sm text-[#111114]">{value}</div>
    </div>
  );
}

function NumInput({ label, value, onSave }: { label: string; value: number | null; onSave: (v: number) => void }) {
  return (
    <div className="bg-white border border-border rounded-md px-2 py-1">
      <div className="text-[10px] tracking-wider text-muted-foreground">{label}</div>
      <input type="number" defaultValue={value ?? 0} onBlur={(e) => onSave(Number(e.target.value) || 0)}
        className="w-full text-sm outline-none" />
    </div>
  );
}

function AddPartner({ onClose, onSave, typeMenuOpen = false }: { onClose: () => void; onSave: (p: Partial<Partner>) => void; typeMenuOpen?: boolean }) {
  const [form, setForm] = useState<Partial<Partner>>({ name: "", email: "", phone: "", partner_type: "private_lender", status: "prospect" });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()} data-testid="add-partner-dialog">
        <h2 className="text-lg font-semibold mb-4">Add Partner</h2>
        <div className="space-y-3 text-sm">
          <input placeholder="Name" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-soft rounded-md px-3 py-2" />
          <input placeholder="Email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-soft rounded-md px-3 py-2" />
          <PhoneInput placeholder="Phone" value={form.phone || ""} onValueChange={(phone) => setForm({ ...form, phone })} className="w-full bg-soft rounded-md px-3 py-2" />
          <PartnerTypeSelect
            stored={form.partner_type || "private_lender"}
            onStored={(partner_type) => setForm({ ...form, partner_type })}
            open={typeMenuOpen}
            triggerClassName="bg-white text-foreground"
            testId="add-partner-type"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button onClick={() => form.name && onSave(form)} className="rounded-md bg-real-red text-white px-4 py-2 text-sm">Add</button>
        </div>
      </div>
    </div>
  );
}

function PartnerTypeSelect({
  stored,
  onStored,
  open = false,
  triggerClassName,
  testId,
}: {
  stored: string;
  onStored: (next: string) => void;
  /** Force the menu open. Only the fixture screenshot passes true. */
  open?: boolean;
  triggerClassName?: string;
  testId?: string;
}) {
  return (
    <Select
      {...(open ? { open: true as const } : {})}
      value={partnerFormValue(stored)}
      onValueChange={(choice) => {
        const next = partnerTypeToStore(choice, stored);
        if (next && next !== stored) onStored(next);
      }}
    >
      <SelectTrigger data-testid={testId ?? "partner-type"} className={triggerClassName}><SelectValue /></SelectTrigger>
      <SelectContent>
        {partnerFormChoices(stored).map((c) => (
          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LinkLoginRow({ partner, onLinked }: { partner: Partner & { user_id?: string | null }; onLinked: () => void }) {
  const linkFn = useServerFn(linkPartnerLogin);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const linked = !!(partner as any).user_id;

  async function link() {
    if (!email) return;
    setBusy(true);
    try {
      await linkFn({ data: { partnerId: partner.id, email } });
      toast.success(`Linked ${email} as partner login`);
      setEmail("");
      onLinked();
    } catch (e: any) {
      toast.error(e?.message || "Could not link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Partner login:</span>
      {linked ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5EE] text-[#127A3E] px-2 py-0.5 text-[11px] font-medium">Linked ✓</span>
      ) : (
        <>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="partner@email.com"
            className="bg-white border border-border rounded-md px-2 py-1 text-xs"
          />
          <button onClick={link} disabled={busy || !email}
            className="rounded-md bg-black text-white px-3 py-1 disabled:opacity-50">
            {busy ? "…" : "Link Login"}
          </button>
          <span className="text-muted-foreground">(account must have signed up at /partner first)</span>
        </>
      )}
    </div>
  );
}