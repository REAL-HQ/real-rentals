import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  X,
  Loader2,
  Car,
  ScrollText,
  ShieldCheck,
  Satellite,
  KeyRound,
  Wrench,
  Lock,
  Images,
  FileText,
  ArrowUpRight,
  Check,
  CircleAlert,
  Building2,
} from "lucide-react";
import {
  updateVehicleSections,
  VEHICLE_STATUSES,
  BODY_TYPES,
  OWNERSHIP_TYPES,
  type VehicleProfile as Profile,
} from "@/lib/vehicles.functions";
import { getVehicleFinance, saveVehicleFinance } from "@/lib/vehicle-finance.functions";
import { checkVin, normalizeVin } from "@/lib/vin";
import { Text, Area, NumberField, DateInput, Choice } from "./VehicleProfileFields";
import { MicroLabel } from "./ui";

// Edit a vehicle without walking every tab.
//
// The profile stays a record you read. This is the fast path over the top of
// it, and it is an *interface* over the canonical systems rather than a second
// way in: it writes through updateVehicleSections (one whitelist, one set of
// identity checks, one audit trail) and through the manager-only finance
// functions. It does not touch vehicles.photos, does not upload documents, and
// does not carry a financial field on the vehicles table, because none of
// those things live there any more.
//
// Photos and documents appear here only as a count and a link. Two places to
// manage the same thing is how the two fall out of step.

type Section = "identity" | "dmv" | "insurance" | "gps" | "keys" | "service";

type Dirty = Partial<Record<Section, Record<string, unknown>>>;

const GROUPS: Array<{ key: Section | "ownership"; label: string; icon: any }> = [
  { key: "identity", label: "Vehicle", icon: Car },
  { key: "dmv", label: "Registration", icon: ScrollText },
  { key: "insurance", label: "Insurance", icon: ShieldCheck },
  { key: "ownership", label: "Ownership", icon: Building2 },
  { key: "gps", label: "GPS", icon: Satellite },
  { key: "keys", label: "Keys", icon: KeyRound },
  { key: "service", label: "Service & tolls", icon: Wrench },
];

const FINANCE_FIELDS = [
  "ownership_type",
  "legal_owner",
  "seller_dealer",
  "lienholder",
  "purchase_date",
  "purchase_price",
  "loan_reference",
  "payoff_amount",
  "monthly_payment",
  "loan_maturity_date",
] as const;

export function VehicleEditorDrawer({
  profile,
  onClose,
  onSaved,
  onOpenTab,
}: {
  profile: Profile & { id: string };
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  /** Jump to a profile tab — Photos and Documents are managed there, not here. */
  onOpenTab: (tab: "photos" | "documents" | "overview") => void;
}) {
  const save = useServerFn(updateVehicleSections);
  const loadFinance = useServerFn(getVehicleFinance);
  const storeFinance = useServerFn(saveVehicleFinance);

  const v = profile.vehicle;

  const [f, setF] = useState<Record<string, any>>(() => ({ ...v }));
  const [dirty, setDirty] = useState<Dirty>({});
  const [fin, setFin] = useState<Record<string, any> | null>(null);
  const [finDirty, setFinDirty] = useState(false);
  const [canFinance, setCanFinance] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState<Section | "ownership">("identity");
  const bodyRef = useRef<HTMLDivElement>(null);

  const hasChanges = Object.values(dirty).some((s) => s && Object.keys(s).length) || finDirty;

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Financing is fetched separately and only if the server will hand it over.
  // A refusal is the answer, not an error: a Coordinator simply has no
  // Ownership money block, and could not save one if the UI showed it.
  useEffect(() => {
    let live = true;
    loadFinance({ data: { vehicle_id: profile.id } })
      .then((r) => {
        if (live) {
          setCanFinance(true);
          setFin(r ? { ...r } : {});
        }
      })
      .catch(() => {
        if (live) setCanFinance(false);
      });
    return () => {
      live = false;
    };
  }, [loadFinance, profile.id]);

  const attemptClose = useCallback(() => {
    if (saving) return;
    if (hasChanges && !confirm("You have unsaved changes. Close without saving?")) return;
    onClose();
  }, [hasChanges, onClose, saving]);

  /**
   * Leaving for the Photos or Documents tab closes this drawer, which throws
   * away anything unsaved just as surely as the X does. It asks first for the
   * same reason.
   */
  const leaveFor = useCallback(
    (tab: "photos" | "documents" | "overview") => {
      if (saving) return;
      if (hasChanges && !confirm("You have unsaved changes. Leave without saving?")) return;
      onOpenTab(tab);
    },
    [hasChanges, onOpenTab, saving],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") attemptClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attemptClose]);

  // The browser's own guard, for a refresh or a closed tab — the confirm()
  // above cannot run then.
  useEffect(() => {
    if (!hasChanges) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasChanges]);

  /** Record a change against its owning section, and drop it again if it returns to the stored value. */
  function set(section: Section, key: string, value: unknown) {
    setF((prev) => ({ ...prev, [key]: value }));
    setErr(null);
    setJustSaved(false);
    setDirty((prev) => {
      const original = (v as Record<string, any>)[key] ?? null;
      const now = value ?? null;
      const same =
        Array.isArray(original) || Array.isArray(now)
          ? JSON.stringify(original ?? []) === JSON.stringify(now ?? [])
          : String(original) === String(now);
      const bucket = { ...(prev[section] ?? {}) };
      if (same) delete bucket[key];
      else bucket[key] = value;
      const next = { ...prev };
      if (Object.keys(bucket).length) next[section] = bucket;
      else delete next[section];
      return next;
    });
  }

  function setFinField(key: string, value: unknown) {
    setFin((prev) => ({ ...(prev ?? {}), [key]: value }));
    setFinDirty(true);
    setErr(null);
    setJustSaved(false);
  }

  const str = (k: string) => (f[k] === null || f[k] === undefined ? "" : String(f[k]));
  const num = (k: string) =>
    f[k] === null || f[k] === undefined || f[k] === "" ? null : Number(f[k]);
  const day = (k: string) => (f[k] ? String(f[k]).slice(0, 10) : "");
  const arr = (k: string): string[] => (Array.isArray(f[k]) ? f[k] : []);

  const fstr = (k: string) => (fin?.[k] === null || fin?.[k] === undefined ? "" : String(fin[k]));
  const fnum = (k: string) =>
    fin?.[k] === null || fin?.[k] === undefined || fin[k] === "" ? null : Number(fin[k]);
  const fday = (k: string) => (fin?.[k] ? String(fin[k]).slice(0, 10) : "");

  // Inline validation, computed rather than stored, so it clears as you type.
  // Reading f.vin directly rather than through str(), which is a new function
  // every render and would make the memo pointless.
  const vinIssue = useMemo(() => {
    const raw = String(f.vin ?? "").trim();
    if (!raw) return null;
    const c = checkVin(raw);
    return c.formatValid && c.checkDigitValid !== false ? null : c.problem;
  }, [f.vin]);
  const vinBlocks = useMemo(() => {
    const raw = String(f.vin ?? "").trim();
    return raw ? !checkVin(raw).formatValid : false;
  }, [f.vin]);
  const rateIssue =
    f.weekly_rate === null || f.weekly_rate === "" ? "A weekly rate is required." : null;
  const emailIssue =
    str("insurance_agent_email").trim() &&
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str("insurance_agent_email").trim())
      ? "That does not look like an email address."
      : null;

  const blocked = vinBlocks || !!rateIssue || !!emailIssue;

  async function submit() {
    if (blocked) {
      setErr({ message: "Fix the highlighted fields first." });
      return;
    }
    if (!hasChanges) return onClose();

    setSaving(true);
    setErr(null);
    try {
      const sections = Object.fromEntries(
        Object.entries(dirty).filter(([, vals]) => vals && Object.keys(vals).length),
      ) as Record<string, Record<string, unknown>>;

      if (Object.keys(sections).length) {
        const res = await save({ data: { id: profile.id, sections } });
        if (!res.ok) {
          setErr({ field: res.field, message: res.error ?? "Could not save." });
          if (res.section) setActive(res.section as Section);
          return;
        }
      }

      if (finDirty && canFinance) {
        const payload: Record<string, unknown> = { vehicle_id: profile.id };
        for (const k of FINANCE_FIELDS) {
          const raw = fin?.[k];
          if (k === "purchase_price" || k === "payoff_amount" || k === "monthly_payment") {
            payload[k] = raw === "" || raw === null || raw === undefined ? null : Number(raw);
          } else {
            payload[k] = raw === "" || raw === undefined ? null : raw;
          }
        }
        const res = await storeFinance({ data: payload as any });
        if (!res.ok) {
          setErr({ message: res.error ?? "The vehicle saved, but its financing did not." });
          setActive("ownership");
          return;
        }
      }

      setDirty({});
      setFinDirty(false);
      setJustSaved(true);
      toast.success("Saved");
      await onSaved();
      setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setErr({
        message: msg === "Forbidden" ? "Editing a vehicle is Manager-only." : "Could not save.",
      });
    } finally {
      setSaving(false);
    }
  }

  function jump(key: Section | "ownership") {
    setActive(key);
    bodyRef.current
      ?.querySelector(`[data-group="${key}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const fieldErr = (k: string) => (err?.field === k ? err.message : undefined);
  const dirtyIn = (s: Section) => !!dirty[s] && Object.keys(dirty[s]!).length > 0;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${mounted ? "opacity-100" : "opacity-0"}`}
        onClick={attemptClose}
      />

      <div
        className={`relative h-full w-full sm:max-w-[760px] bg-[#FAFAFB] shadow-2xl flex flex-col transition-transform duration-200 ease-out ${
          mounted ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* ---- header ---------------------------------------------------- */}
        <header className="bg-white border-b border-[#EDEDF0] px-5 py-3.5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-[#111114] truncate">Edit vehicle</h2>
            <p className="text-[12px] text-[#9A9AA3] truncate">
              {profile.unitLabel}
              {hasChanges && <span className="ml-2 text-[#C68A12]">· Unsaved changes</span>}
              {!hasChanges && justSaved && <span className="ml-2 text-[#3E9A4C]">· Saved</span>}
            </p>
          </div>
          <button
            onClick={attemptClose}
            className="shrink-0 rounded-md p-1.5 text-[#9A9AA3] hover:text-[#111114] hover:bg-[#F4F4F6] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* ---- jump bar --------------------------------------------------- */}
        <nav className="bg-white border-b border-[#EDEDF0] px-3 flex gap-0.5 overflow-x-auto">
          {GROUPS.map((g) => {
            if (g.key === "ownership" && !canFinance) return null;
            const on = active === g.key;
            const marked = g.key === "ownership" ? finDirty : dirtyIn(g.key as Section);
            return (
              <button
                key={g.key}
                onClick={() => jump(g.key)}
                className={`relative inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2 text-[12px] border-b-2 transition-colors ${
                  on
                    ? "border-[#D03020] text-[#111114] font-medium"
                    : "border-transparent text-[#9A9AA3] hover:text-[#55555E]"
                }`}
              >
                <g.icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                {g.label}
                {marked && <span className="h-1.5 w-1.5 rounded-full bg-[#C68A12]" />}
              </button>
            );
          })}
        </nav>

        {/* ---- body -------------------------------------------------------- */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {err && !err.field && (
            <div className="rounded-lg bg-[rgba(208,48,32,0.08)] px-3.5 py-2.5 flex items-start gap-2">
              <CircleAlert className="w-4 h-4 text-[#D03020] shrink-0 mt-0.5" />
              <div className="text-[12px] text-[#D03020]">{err.message}</div>
            </div>
          )}

          {/* ===== 1. Vehicle ============================================== */}
          <Group id="identity" title="Vehicle" icon={Car}>
            <Grid>
              <Text
                label="Unit number"
                value={str("unit_number")}
                onChange={(x) => set("identity", "unit_number", x)}
                error={fieldErr("unit_number")}
                placeholder="RR-001"
              />
              {/* Reads here, saves under `dmv` — that is the whitelist that
                  owns the column, and sending it as `identity` would drop it
                  silently. Visual grouping and section ownership are allowed
                  to differ; getting them confused is not. */}
              <Text
                label="VIN"
                value={str("vin")}
                onChange={(x) => set("dmv", "vin", normalizeVin(x))}
                error={fieldErr("vin") ?? (vinBlocks ? (vinIssue ?? undefined) : undefined)}
                hint={!vinBlocks && vinIssue ? vinIssue : "17 characters. Never I, O or Q."}
                mono
              />
              <NumberField
                label="Year"
                value={num("year")}
                onChange={(x) => set("identity", "year", x)}
              />
              <Text label="Make" value={str("make")} onChange={(x) => set("identity", "make", x)} />
              <Text
                label="Model"
                value={str("model")}
                onChange={(x) => set("identity", "model", x)}
              />
              <Text label="Trim" value={str("trim")} onChange={(x) => set("identity", "trim", x)} />
              <Text
                label="Color"
                value={str("color")}
                onChange={(x) => set("identity", "color", x)}
              />
              <Choice
                label="Body type"
                value={str("body_type")}
                onChange={(x) => set("identity", "body_type", x)}
                options={[
                  { value: "", label: "—" },
                  ...BODY_TYPES.map((b) => ({ value: b, label: b })),
                ]}
              />
              <NumberField
                label="Odometer"
                value={num("current_odometer")}
                onChange={(x) => set("identity", "current_odometer", x)}
                suffix="mi"
              />
              <Choice
                label="Status"
                value={str("status")}
                onChange={(x) => set("identity", "status", x)}
                options={VEHICLE_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
                hint="Taking a car out of the fleet is refused while a rental is active."
              />
            </Grid>

            <Sub>Specification</Sub>
            <Grid>
              <NumberField
                label="Seats"
                value={num("seats")}
                onChange={(x) => set("identity", "seats", x)}
              />
              <NumberField
                label="Doors"
                value={num("doors")}
                onChange={(x) => set("identity", "doors", x)}
              />
              <Text
                label="Fuel"
                value={str("fuel_type")}
                onChange={(x) => set("identity", "fuel_type", x)}
              />
              <NumberField
                label="MPG"
                value={num("mpg")}
                onChange={(x) => set("identity", "mpg", x)}
              />
              <NumberField
                label="Range per tank"
                value={num("miles_per_tank")}
                onChange={(x) => set("identity", "miles_per_tank", x)}
                suffix="mi"
              />
            </Grid>

            <Sub>Listing &amp; pricing</Sub>
            <Grid>
              <NumberField
                label="Weekly rate"
                value={num("weekly_rate")}
                onChange={(x) => set("identity", "weekly_rate", x)}
                suffix="$"
                error={fieldErr("weekly_rate") ?? rateIssue ?? undefined}
              />
              <NumberField
                label="Monthly rate"
                value={num("monthly_rate")}
                onChange={(x) => set("identity", "monthly_rate", x)}
                suffix="$"
              />
              <NumberField
                label="Deposit"
                value={num("deposit")}
                onChange={(x) => set("identity", "deposit", x)}
                suffix="$"
              />
            </Grid>
            <TagList
              label="Platforms"
              values={arr("uber_eligibility")}
              onChange={(next) => set("identity", "uber_eligibility", next)}
              suggestions={["uber", "lyft", "doordash", "instacart", "amazon_flex", "grubhub"]}
            />
            <TagList
              label="Badges"
              values={arr("badges")}
              onChange={(next) => set("identity", "badges", next)}
              suggestions={["Unlimited Miles", "Maintenance Included", "Hybrid", "New Arrival"]}
            />
            <Area
              label="Listing description"
              value={str("description")}
              onChange={(x) => set("identity", "description", x)}
              hint="Shown on the public fleet page."
            />
            <Area
              label="Internal notes"
              value={str("internal_notes")}
              onChange={(x) => set("identity", "internal_notes", x)}
              rows={2}
              hint="Never leaves the back office."
            />

            <PhotoSummary profile={profile} onOpen={() => leaveFor("photos")} />
          </Group>

          {/* ===== 2. Registration ========================================= */}
          <Group id="dmv" title="Registration" icon={ScrollText}>
            <Grid>
              <Text
                label="Plate"
                value={str("license_plate")}
                onChange={(x) => set("dmv", "license_plate", x)}
                error={fieldErr("license_plate")}
                mono
              />
              <Text
                label="Plate state"
                value={str("plate_state")}
                onChange={(x) => set("dmv", "plate_state", x)}
              />
              <DateInput
                label="Plate expires"
                value={day("plate_expires_on")}
                onChange={(x) => set("dmv", "plate_expires_on", x)}
              />
              <Text
                label="Registration #"
                value={str("registration_number")}
                onChange={(x) => set("dmv", "registration_number", x)}
                mono
              />
              <Text
                label="Registration state"
                value={str("registration_state")}
                onChange={(x) => set("dmv", "registration_state", x)}
              />
              <DateInput
                label="Registration expires"
                value={day("registration_expires_on")}
                onChange={(x) => set("dmv", "registration_expires_on", x)}
              />
              <Text
                label="Title number"
                value={str("title_number")}
                onChange={(x) => set("dmv", "title_number", x)}
                mono
              />
              <Choice
                label="Title status"
                value={str("title_status")}
                onChange={(x) => set("dmv", "title_status", x)}
                options={[
                  { value: "", label: "—" },
                  { value: "clean", label: "Clean" },
                  { value: "financed", label: "Financed" },
                  { value: "lien", label: "Lien" },
                  { value: "salvage", label: "Salvage" },
                  { value: "rebuilt", label: "Rebuilt" },
                ]}
              />
            </Grid>
            <DocLink
              label="Title and registration documents"
              hint="Files, expiry dates and version history live in the document vault."
              onOpen={() => leaveFor("documents")}
            />
          </Group>

          {/* ===== 3. Insurance ============================================ */}
          <Group id="insurance" title="Insurance" icon={ShieldCheck}>
            <Grid>
              <Text
                label="Carrier"
                value={str("insurance_carrier")}
                onChange={(x) => set("insurance", "insurance_carrier", x)}
              />
              <Text
                label="Policy number"
                value={str("insurance_policy_number")}
                onChange={(x) => set("insurance", "insurance_policy_number", x)}
                mono
              />
              <Text
                label="Coverage"
                value={str("insurance_coverage")}
                onChange={(x) => set("insurance", "insurance_coverage", x)}
                placeholder="Commercial, full"
              />
              <DateInput
                label="Effective"
                value={day("insurance_effective_on")}
                onChange={(x) => set("insurance", "insurance_effective_on", x)}
              />
              <DateInput
                label="Expires"
                value={day("insurance_expires_on")}
                onChange={(x) => set("insurance", "insurance_expires_on", x)}
                hint="Drives the expiry warnings."
              />
              <Choice
                label="Status"
                value={str("insurance_status")}
                onChange={(x) => set("insurance", "insurance_status", x)}
                options={[
                  { value: "", label: "—" },
                  { value: "active", label: "Active" },
                  { value: "lapsed", label: "Lapsed" },
                  { value: "pending", label: "Pending" },
                  { value: "cancelled", label: "Cancelled" },
                ]}
              />
            </Grid>
            <Sub>Agent</Sub>
            <Grid>
              <Text
                label="Name"
                value={str("insurance_agent_name")}
                onChange={(x) => set("insurance", "insurance_agent_name", x)}
              />
              <Text
                label="Phone"
                value={str("insurance_agent_phone")}
                onChange={(x) => set("insurance", "insurance_agent_phone", x)}
              />
              <Text
                label="Email"
                value={str("insurance_agent_email")}
                onChange={(x) => set("insurance", "insurance_agent_email", x)}
                error={emailIssue ?? undefined}
              />
            </Grid>
            <DocLink
              label="Insurance card"
              hint="Upload and view the card in the document vault."
              onOpen={() => leaveFor("documents")}
            />
          </Group>

          {/* ===== 4. Ownership ============================================ */}
          <Group id="ownership" title="Ownership" icon={Building2}>
            <Grid>
              <Text
                label="Assigned partner"
                value={profile.partnerName ?? ""}
                onChange={() => {}}
                readOnly
                hint="Change a partner assignment from the fleet list."
              />
            </Grid>

            {canFinance ? (
              <>
                <div className="flex items-center gap-2 mt-4 mb-2">
                  <Lock className="w-3.5 h-3.5 text-[#55555E]" />
                  <MicroLabel>Acquisition &amp; financing</MicroLabel>
                  <span className="rounded-full bg-[#F4F4F6] px-2 py-0.5 text-[10px] font-medium text-[#55555E]">
                    Owners and managers
                  </span>
                </div>
                <p className="text-[11px] text-[#9A9AA3] mb-3 leading-relaxed">
                  Kept in a separate table behind its own policy. A Coordinator gets no rows from it
                  — not hidden here, genuinely unreadable to them.
                </p>
                <Grid>
                  <Choice
                    label="Ownership"
                    value={fstr("ownership_type")}
                    onChange={(x) => setFinField("ownership_type", x)}
                    options={[
                      { value: "", label: "—" },
                      ...OWNERSHIP_TYPES.map((o) => ({ value: o.value, label: o.label })),
                    ]}
                  />
                  <Text
                    label="Legal owner"
                    value={fstr("legal_owner")}
                    onChange={(x) => setFinField("legal_owner", x)}
                  />
                  <Text
                    label="Seller / dealer"
                    value={fstr("seller_dealer")}
                    onChange={(x) => setFinField("seller_dealer", x)}
                  />
                  <Text
                    label="Lienholder"
                    value={fstr("lienholder")}
                    onChange={(x) => setFinField("lienholder", x)}
                  />
                  <DateInput
                    label="Purchase date"
                    value={fday("purchase_date")}
                    onChange={(x) => setFinField("purchase_date", x)}
                  />
                  <NumberField
                    label="Purchase price"
                    value={fnum("purchase_price")}
                    onChange={(x) => setFinField("purchase_price", x)}
                    suffix="$"
                  />
                  <Text
                    label="Loan / lease ref"
                    value={fstr("loan_reference")}
                    onChange={(x) => setFinField("loan_reference", x)}
                    mono
                  />
                  <NumberField
                    label="Payoff"
                    value={fnum("payoff_amount")}
                    onChange={(x) => setFinField("payoff_amount", x)}
                    suffix="$"
                  />
                  <NumberField
                    label="Monthly payment"
                    value={fnum("monthly_payment")}
                    onChange={(x) => setFinField("monthly_payment", x)}
                    suffix="$"
                  />
                  <DateInput
                    label="Matures"
                    value={fday("loan_maturity_date")}
                    onChange={(x) => setFinField("loan_maturity_date", x)}
                  />
                </Grid>
              </>
            ) : (
              <p className="text-[12px] text-[#9A9AA3] mt-2 leading-relaxed">
                Acquisition and financing are Owner and Manager only.
              </p>
            )}
          </Group>

          {/* ===== 5. GPS ================================================== */}
          <Group id="gps" title="GPS / telematics" icon={Satellite}>
            <Sub>Device — entered by hand</Sub>
            <Grid>
              <Text
                label="Provider"
                value={str("gps_provider")}
                onChange={(x) => set("gps", "gps_provider", x)}
              />
              <Choice
                label="Device status"
                value={str("gps_status")}
                onChange={(x) => set("gps", "gps_status", x)}
                options={[
                  { value: "", label: "—" },
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                  { value: "fault", label: "Fault" },
                  { value: "removed", label: "Removed" },
                  { value: "not_installed", label: "Not installed" },
                ]}
              />
              <Text
                label="Device ID"
                value={str("gps_device_id")}
                onChange={(x) => set("gps", "gps_device_id", x)}
                mono
              />
              <Text
                label="Serial"
                value={str("gps_serial")}
                onChange={(x) => set("gps", "gps_serial", x)}
                mono
              />
              <Text
                label="IMEI"
                value={str("gps_imei")}
                onChange={(x) => set("gps", "gps_imei", x)}
                mono
              />
              <Text
                label="SIM"
                value={str("gps_sim")}
                onChange={(x) => set("gps", "gps_sim", x)}
                mono
              />
              <DateInput
                label="Installed"
                value={day("gps_installed_on")}
                onChange={(x) => set("gps", "gps_installed_on", x)}
              />
            </Grid>
            <Text
              label="Tracking link"
              value={str("gps_tracking_url")}
              onChange={(x) => set("gps", "gps_tracking_url", x)}
              placeholder="https://"
            />
            <Area
              label="Install notes"
              value={str("gps_install_notes")}
              onChange={(x) => set("gps", "gps_install_notes", x)}
              rows={2}
            />

            <Sub>Reported by the provider</Sub>
            <p className="text-[11px] text-[#9A9AA3] -mt-1 mb-2 leading-relaxed">
              Written by a provider adapter, not by this app. No adapter is connected yet, so these
              stay as last recorded. Blank means nothing has been received — not that the car is
              stationary. Only the odometer is editable, for correcting a bad reading.
            </p>
            <Grid>
              <NumberField
                label="Reported odometer"
                value={num("gps_odometer")}
                onChange={(x) => set("gps", "gps_odometer", x)}
                suffix="mi"
              />
              <Text
                label="Last ping"
                value={
                  v.gps_last_ping_at ? new Date(String(v.gps_last_ping_at)).toLocaleString() : ""
                }
                onChange={() => {}}
                readOnly
              />
              <Text
                label="Battery"
                value={String(v.gps_battery ?? "")}
                onChange={() => {}}
                readOnly
              />
              <Text
                label="Geofence"
                value={String(v.gps_geofence_status ?? "")}
                onChange={() => {}}
                readOnly
              />
            </Grid>
          </Group>

          {/* ===== 6. Keys ================================================= */}
          <Group id="keys" title="Keys" icon={KeyRound}>
            <Grid>
              <NumberField
                label="Number of keys"
                value={num("key_count")}
                onChange={(x) => set("keys", "key_count", x)}
              />
              <Choice
                label="Spare key"
                value={f.spare_key === true ? "true" : f.spare_key === false ? "false" : ""}
                onChange={(x) => set("keys", "spare_key", x === "" ? null : x === "true")}
                options={[
                  { value: "", label: "Not recorded" },
                  { value: "true", label: "Yes — a spare exists" },
                  { value: "false", label: "No spare" },
                ]}
              />
              <Text
                label="Key / fob type"
                value={str("key_type")}
                onChange={(x) => set("keys", "key_type", x)}
                placeholder="Fob, smart, blade"
              />
              <Text
                label="Key tag"
                value={str("key_tag")}
                onChange={(x) => set("keys", "key_tag", x)}
                mono
              />
              <Text
                label="Key location"
                value={str("key_location")}
                onChange={(x) => set("keys", "key_location", x)}
                placeholder="Hook 4, back office"
              />
            </Grid>
            <Area
              label="Notes"
              value={str("key_notes")}
              onChange={(x) => set("keys", "key_notes", x)}
              rows={2}
              hint="Never included in a shared vehicle summary."
            />
          </Group>

          {/* ===== 7. Service & tolls ====================================== */}
          <Group id="service" title="Service intervals & tolls" icon={Wrench}>
            <Grid>
              <Text
                label="Maintenance status"
                value={str("maintenance_status")}
                onChange={(x) => set("service", "maintenance_status", x)}
              />
              <NumberField
                label="Oil interval"
                value={num("oil_interval_miles")}
                onChange={(x) => set("service", "oil_interval_miles", x)}
                suffix="mi"
              />
              <NumberField
                label="Last oil change at"
                value={num("last_oil_change_miles")}
                onChange={(x) => set("service", "last_oil_change_miles", x)}
                suffix="mi"
              />
              <DateInput
                label="Last tyres"
                value={day("last_tire_date")}
                onChange={(x) => set("service", "last_tire_date", x)}
              />
              <DateInput
                label="Last brake inspection"
                value={day("last_brake_inspection_date")}
                onChange={(x) => set("service", "last_brake_inspection_date", x)}
              />
              <Text
                label="Toll transponder"
                value={str("toll_transponder_id")}
                onChange={(x) => set("service", "toll_transponder_id", x)}
                mono
              />
              <Text
                label="Toll account"
                value={str("toll_account")}
                onChange={(x) => set("service", "toll_account", x)}
                mono
              />
            </Grid>
            <p className="text-[11px] text-[#9A9AA3] leading-relaxed">
              These are the intervals stored on the vehicle. Work orders, schedules, inspections and
              rentals are their own records and are not edited here.
            </p>
          </Group>
        </div>

        {/* ---- footer ------------------------------------------------------ */}
        <footer className="bg-white border-t border-[#EDEDF0] px-5 py-3.5 flex items-center gap-3">
          <div className="flex-1 min-w-0 text-[12px]">
            {saving ? (
              <span className="inline-flex items-center gap-1.5 text-[#55555E]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
              </span>
            ) : justSaved && !hasChanges ? (
              <span className="inline-flex items-center gap-1.5 text-[#3E9A4C]">
                <Check className="w-3.5 h-3.5" /> Saved
              </span>
            ) : hasChanges ? (
              <span className="text-[#C68A12]">Unsaved changes</span>
            ) : (
              <span className="text-[#9A9AA3]">No changes</span>
            )}
          </div>
          <button
            onClick={attemptClose}
            disabled={saving}
            className="rounded-md px-3.5 py-2 text-[13px] text-[#55555E] hover:bg-[#F4F4F6] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !hasChanges || blocked}
            className="inline-flex items-center gap-2 rounded-md bg-[#D03020] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save changes
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---- layout ---------------------------------------------------------------

function Group({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <section
      data-group={id}
      className="scroll-mt-3 rounded-2xl border border-[#EDEDF0] bg-white shadow-sm"
    >
      <header className="flex items-center gap-2.5 border-b border-[#EDEDF0] px-5 py-3">
        <Icon className="w-4 h-4 text-[#55555E]" strokeWidth={1.75} />
        <h3 className="text-[13px] font-semibold text-[#111114]">{title}</h3>
      </header>
      <div className="p-5 space-y-3">{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

function Sub({ children }: { children: React.ReactNode }) {
  return <MicroLabel className="pt-2">{children}</MicroLabel>;
}

// ---- cross-links to the canonical systems ---------------------------------

function PhotoSummary({ profile, onOpen }: { profile: Profile; onOpen: () => void }) {
  const n = profile.counts.photos;
  const lead = (profile.vehicle.photos as string[] | null)?.[0] ?? null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full mt-2 flex items-center gap-3 rounded-xl border border-[#EDEDF0] px-3.5 py-3 text-left hover:border-[#D03020] hover:bg-[rgba(208,48,32,0.02)] transition-colors"
    >
      <div className="h-10 w-14 shrink-0 rounded-md bg-[#F4F4F6] overflow-hidden grid place-items-center">
        {lead ? <LeadThumb path={lead} /> : <Images className="w-4 h-4 text-[#C4C4CB]" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-[#111114]">
          {n === 0 ? "No photos" : `${n} photo${n === 1 ? "" : "s"}`}
          {lead && <span className="text-[#9A9AA3]"> · lead photo set</span>}
        </div>
        <div className="text-[11px] text-[#9A9AA3]">
          Managed on the Photos tab — the website order is derived from it.
        </div>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 text-[12px] text-[#D03020]">
        Manage photos <ArrowUpRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

function LeadThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import("@/lib/photoUrl").then((m) => {
      if (live) setUrl(m.resolvePhotoUrl(path));
    });
    return () => {
      live = false;
    };
  }, [path]);
  return url ? (
    <img src={url} alt="" className="h-full w-full object-cover" />
  ) : (
    <Images className="w-4 h-4 text-[#C4C4CB]" />
  );
}

function DocLink({ label, hint, onOpen }: { label: string; hint: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full mt-2 flex items-center gap-3 rounded-xl border border-[#EDEDF0] px-3.5 py-3 text-left hover:border-[#D03020] hover:bg-[rgba(208,48,32,0.02)] transition-colors"
    >
      <FileText className="w-4 h-4 shrink-0 text-[#55555E]" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-[#111114]">{label}</div>
        <div className="text-[11px] text-[#9A9AA3]">{hint}</div>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 text-[12px] text-[#D03020]">
        Manage documents <ArrowUpRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

// ---- tag editor for the two text[] columns --------------------------------

function TagList({
  label,
  values,
  onChange,
  suggestions,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const v = raw.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setDraft("");
  };
  const unused = suggestions.filter((s) => !values.includes(s));
  return (
    <div>
      <MicroLabel className="mb-1.5">{label}</MicroLabel>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-[#F4F4F6] pl-2.5 pr-1 py-0.5 text-[11px] text-[#111114]"
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== t))}
              className="rounded-full p-0.5 text-[#9A9AA3] hover:text-[#D03020]"
              aria-label={`Remove ${t}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {!values.length && <span className="text-[12px] text-[#C4C4CB]">None</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder="Add and press Enter"
          className="flex-1 h-9 rounded-md border border-[#EDEDF0] bg-white px-2.5 text-[13px] outline-none focus:border-[#D03020] transition-colors"
        />
      </div>
      {!!unused.length && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {unused.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border border-dashed border-[#DCDCE2] px-2 py-0.5 text-[11px] text-[#9A9AA3] hover:border-[#D03020] hover:text-[#D03020] transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
