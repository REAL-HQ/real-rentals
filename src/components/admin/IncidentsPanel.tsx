import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, ShieldAlert, Trash2 } from "lucide-react";
import { StatusPill, EmptyState, MicroLabel } from "./ui";
import {
  listIncidents,
  saveIncident,
  deleteIncident,
  INCIDENT_TYPES,
  type Incident,
} from "@/lib/incidents.functions";
import { incidentSeedForIssue } from "@/lib/driver-issues.functions";
import type { IssueIncidentSeed } from "@/lib/driver-issues";
import { fmtDateTime } from "@/lib/date-format";
import { INCIDENT_CHARGE_PREP_ENABLED } from "@/lib/incident-charge-prep-flag";
import { listIncidentChargePrep } from "@/lib/incident-charge-prep.functions";
import type { IncidentChargePrepRow } from "@/lib/incident-charge-prep";

type VehicleLite = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
};
type Vendor = { id: string; name: string };

const STATUSES = ["open", "in_claim", "repairing", "closed", "written_off"] as const;
const SEVERITIES = ["minor", "moderate", "major", "total_loss"] as const;
const FAULTS = ["unknown", "driver", "third_party", "none"] as const;

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function IncidentsPanel({ seedIssueId = null }: { seedIssueId?: string | null }) {
  const fetchList = useServerFn(listIncidents);
  const remove = useServerFn(deleteIncident);
  const fetchSeed = useServerFn(incidentSeedForIssue);

  const [rows, setRows] = useState<Incident[]>([]);
  const [vehicles, setVehicles] = useState<VehicleLite[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [remainingOnly, setRemainingOnly] = useState(false);
  const [prepRows, setPrepRows] = useState<IncidentChargePrepRow[]>([]);
  const [prepTruncated, setPrepTruncated] = useState(false);
  const [editing, setEditing] = useState<Incident | "new" | null>(null);
  const [seed, setSeed] = useState<IssueIncidentSeed | null>(null);
  const prepById = new Map(prepRows.map((row) => [row.incidentId, row.proposedAmount]));

  async function load() {
    setLoading(true);
    try {
      const [list, v, vd] = await Promise.all([
        fetchList({ data: { status: filter } }),
        supabase.from("vehicles").select("id,year,make,model,license_plate").order("make"),
        supabase.from("vendors").select("id,name").eq("is_active", true).order("name"),
      ]);
      setRows(list);
      setVehicles((v.data as any) ?? []);
      setVendors((vd.data as any) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load incidents");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    if (!seedIssueId) return;
    let cancelled = false;
    void fetchSeed({ data: { id: seedIssueId } })
      .then((next) => {
        if (cancelled || !next) return;
        setSeed(next);
        setEditing("new");
      })
      .catch(() => {
        /* The incidents list still works if the issue cannot be read. */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedIssueId]);

  const openCount = rows.filter((r) => r.status !== "closed" && r.status !== "written_off").length;
  const shown =
    INCIDENT_CHARGE_PREP_ENABLED && remainingOnly
      ? rows.filter((r) => (prepById.get(r.id) ?? 0) > 0)
      : rows;

  return (
    <div className="space-y-4">
      <div className="admin-sticky-bar flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{rows.length} incident(s)</span>
          {openCount > 0 ? <StatusPill tone="amber">{openCount} open</StatusPill> : null}
        </div>
        <button
          onClick={() => {
            setSeed(null);
            setEditing("new");
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Log Incident
        </button>
      </div>

      <RemainingToChargeLoader onRows={setPrepRows} onTruncated={setPrepTruncated} />
      {INCIDENT_CHARGE_PREP_ENABLED && prepTruncated ? (
        <p className="text-[12px] text-[#55555E]">Remaining To Charge Is Capped</p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {["all", ...STATUSES].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium border capitalize transition-colors ${
              filter === s
                ? "border-[#D03020] bg-[#D03020] text-white"
                : "border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
            }`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
        {INCIDENT_CHARGE_PREP_ENABLED ? (
          <button
            type="button"
            onClick={() => setRemainingOnly((on) => !on)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              remainingOnly
                ? "border-[#D03020] bg-[#D03020] text-white"
                : "border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
            }`}
          >
            Remaining to Charge
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert className="w-6 h-6" strokeWidth={1.75} />}
          title="No Incidents"
          hint="Log an accident, damage or breakdown to track the claim and what the renter owes."
        />
      ) : (
        <div className="space-y-3">
          {shown.map((r) => {
            const net = r.actual_cost - r.insurance_payout - r.driver_responsible_amount;
            return (
              <div
                key={r.id}
                className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm p-4"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold capitalize">
                        {r.incident_type.replace(/_/g, " ")}
                      </span>
                      <StatusPill
                        status={
                          r.status === "closed"
                            ? "active"
                            : r.status === "written_off"
                              ? "overdue"
                              : "pending"
                        }
                      >
                        {r.status.replace(/_/g, " ")}
                      </StatusPill>
                      {r.severity !== "minor" ? (
                        <StatusPill tone={r.severity === "total_loss" ? "red" : "amber"}>
                          {r.severity.replace(/_/g, " ")}
                        </StatusPill>
                      ) : null}
                      {r.injuries ? <StatusPill tone="red">injuries</StatusPill> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {fmtDateTime(r.occurred_at)} ·{" "}
                      {r.vehicle_label ?? "unknown vehicle"}
                      {r.driver_name ? ` · ${r.driver_name}` : " · no renter assigned"}
                      {r.location ? ` · ${r.location}` : ""}
                    </p>
                    {r.description ? (
                      <p className="mt-1.5 text-sm text-[#55555E]">{r.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(r)}
                      className="text-xs font-semibold text-[#D03020] px-2 py-1"
                    >
                      Edit
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm("Delete this incident?")) return;
                        await remove({ data: { id: r.id } });
                        load();
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#55555E] hover:text-[#D03020]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {r.estimated_cost > 0 || r.actual_cost > 0 || r.claim_number ? (
                  <div className="mt-3 pt-3 border-t border-[#EDEDF0] grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <Fig label="Fault" text={r.at_fault.replace(/_/g, " ")} />
                    <Fig label="Estimate" text={money(r.estimated_cost)} />
                    <Fig label="Actual" text={money(r.actual_cost)} />
                    <Fig label="Insurance Paid" text={money(r.insurance_payout)} />
                    <Fig label="Renter Owes" text={money(r.driver_responsible_amount)} />
                    {r.claim_number ? (
                      <Fig
                        label="Claim"
                        text={`${r.claim_number}${r.insurance_carrier ? ` · ${r.insurance_carrier}` : ""}`}
                      />
                    ) : null}
                    {r.actual_cost > 0 ? (
                      <Fig label="Net to Company" text={money(net)} strong />
                    ) : null}
                  </div>
                ) : null}
                {INCIDENT_CHARGE_PREP_ENABLED ? (
                  <div className="mt-3 pt-3 border-t border-[#EDEDF0] text-xs" title="This Does Not Create a Charge.">
                    <div className="text-[10px] tracking-wide text-[#9A9AA3]">Remaining to Charge</div>
                    <div>{prepById.get(r.id) == null ? "" : money(prepById.get(r.id) as number)}</div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {editing ? (
        <IncidentForm
          key={editing === "new" ? (seed ? `seed-${seedIssueId ?? "x"}` : "blank") : editing.id}
          incident={editing === "new" ? null : editing}
          seed={editing === "new" ? seed : null}
          vehicles={vehicles}
          vendors={vendors}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function RemainingToChargeLoader({
  onRows,
  onTruncated,
}: {
  onRows: (rows: IncidentChargePrepRow[]) => void;
  onTruncated: (truncated: boolean) => void;
}) {
  if (!INCIDENT_CHARGE_PREP_ENABLED) return null;
  return <RemainingToChargeFetch onRows={onRows} onTruncated={onTruncated} />;
}

function RemainingToChargeFetch({
  onRows,
  onTruncated,
}: {
  onRows: (rows: IncidentChargePrepRow[]) => void;
  onTruncated: (truncated: boolean) => void;
}) {
  const load = useServerFn(listIncidentChargePrep);
  useEffect(() => {
    let cancelled = false;
    void load({ data: {} })
      .then((next) => {
        if (!cancelled) {
          onRows(next.rows);
          onTruncated(next.truncated);
        }
      })
      .catch(() => {
        if (!cancelled) {
          onRows([]);
          onTruncated(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load, onRows, onTruncated]);
  return null;
}

function Fig({ label, text, strong }: { label: string; text: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#9A9AA3]">{label}</div>
      <div className={`capitalize ${strong ? "font-semibold" : ""}`}>{text}</div>
    </div>
  );
}

function IncidentForm({
  incident,
  seed,
  vehicles,
  vendors,
  onClose,
  onSaved,
}: {
  incident: Incident | null;
  seed?: IssueIncidentSeed | null;
  vehicles: VehicleLite[];
  vendors: Vendor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useServerFn(saveIncident);
  const [f, setF] = useState({
    vehicleId: incident?.vehicle_id ?? seed?.vehicleId ?? (seed ? "" : vehicles[0]?.id ?? ""),
    incidentType: incident?.incident_type ?? seed?.incidentType ?? "accident",
    occurredAt: (incident?.occurred_at ?? seed?.occurredAt ?? new Date().toISOString()).slice(0, 16),
    location: incident?.location ?? "",
    description: incident?.description ?? seed?.description ?? "",
    atFault: incident?.at_fault ?? "unknown",
    injuries: incident?.injuries ?? false,
    drivable: incident?.drivable ?? null,
    policeReportNumber: incident?.police_report_number ?? "",
    otherParty: incident?.other_party ?? "",
    severity: incident?.severity ?? "minor",
    status: incident?.status ?? "open",
    claimNumber: incident?.claim_number ?? "",
    insuranceCarrier: incident?.insurance_carrier ?? "",
    deductible: String(incident?.deductible ?? ""),
    estimatedCost: String(incident?.estimated_cost ?? ""),
    actualCost: String(incident?.actual_cost ?? ""),
    insurancePayout: String(incident?.insurance_payout ?? ""),
    driverResponsibleAmount: String(incident?.driver_responsible_amount ?? ""),
    vendorId: incident?.vendor_id ?? "",
    notes: incident?.notes ?? "",
    markVehicleDown: false,
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }
  const num = (s: string) => Number(String(s).replace(/[^\d.]/g, "")) || 0;

  async function submit() {
    if (!f.vehicleId) return toast.error("Pick a vehicle.");
    setBusy(true);
    try {
      const res = await save({
        data: {
          id: incident?.id,
          vehicleId: f.vehicleId,
          incidentType: f.incidentType,
          occurredAt: new Date(f.occurredAt).toISOString(),
          location: f.location.trim() || null,
          description: f.description.trim() || null,
          atFault: f.atFault as any,
          injuries: f.injuries,
          drivable: f.drivable,
          policeReportNumber: f.policeReportNumber.trim() || null,
          otherParty: f.otherParty.trim() || null,
          severity: f.severity as any,
          status: f.status as any,
          claimNumber: f.claimNumber.trim() || null,
          insuranceCarrier: f.insuranceCarrier.trim() || null,
          deductible: num(f.deductible),
          estimatedCost: num(f.estimatedCost),
          actualCost: num(f.actualCost),
          insurancePayout: num(f.insurancePayout),
          driverResponsibleAmount: num(f.driverResponsibleAmount),
          vendorId: f.vendorId || null,
          notes: f.notes.trim() || null,
          markVehicleDown: f.markVehicleDown,
        },
      });
      toast[res.attributed ? "success" : "warning"](
        res.attributed
          ? "Incident saved and linked to the renter"
          : "Incident saved — no renter had the car then",
      );
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const Txt = (label: string, k: keyof typeof f, placeholder?: string) => (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <input
        value={String(f[k] ?? "")}
        placeholder={placeholder}
        onChange={(e) => set(k, e.target.value as any)}
        className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
      />
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#EDEDF0] sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold">{incident ? "Edit Incident" : "Log Incident"}</h3>
            {seed && !incident ? (
              <p className="text-[12px] text-[#55555E]">Prefilled from a driver issue. Nothing is saved until you log it.</p>
            ) : null}
          </div>
          <button onClick={onClose} className="text-[#55555E] hover:text-[#111114]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <MicroLabel>Vehicle</MicroLabel>
              <select
                value={f.vehicleId}
                onChange={(e) => set("vehicleId", e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {[v.year, v.make, v.model].filter(Boolean).join(" ")}
                    {v.license_plate ? ` · ${v.license_plate}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <MicroLabel>When</MicroLabel>
              <input
                type="datetime-local"
                value={f.occurredAt}
                onChange={(e) => set("occurredAt", e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
              />
            </div>
            <Sel
              label="Type"
              value={f.incidentType}
              onChange={(v) => set("incidentType", v)}
              options={INCIDENT_TYPES.map((t) => [t.value, t.label])}
            />
            <Sel
              label="Severity"
              value={f.severity}
              onChange={(v) => set("severity", v)}
              options={SEVERITIES.map((s) => [s, s.replace(/_/g, " ")])}
            />
            <Sel
              label="At Fault"
              value={f.atFault}
              onChange={(v) => set("atFault", v)}
              options={FAULTS.map((s) => [s, s.replace(/_/g, " ")])}
            />
            <Sel
              label="Status"
              value={f.status}
              onChange={(v) => set("status", v)}
              options={STATUSES.map((s) => [s, s.replace(/_/g, " ")])}
            />
            {Txt("Location", "location")}
            {Txt("Police report #", "policeReportNumber")}
          </div>

          <div>
            <MicroLabel>What happened</MicroLabel>
            <textarea
              value={f.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
            />
          </div>
          {Txt("Other party (name, insurer, plate)", "otherParty")}

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.injuries}
                onChange={(e) => set("injuries", e.target.checked)}
              />
              Injuries reported
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.drivable === true}
                onChange={(e) => set("drivable", e.target.checked ? true : false)}
              />
              Still drivable
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.markVehicleDown}
                onChange={(e) => set("markVehicleDown", e.target.checked)}
              />
              Take vehicle off the road
            </label>
          </div>

          <div className="rounded-xl border border-[#EDEDF0] p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#55555E]">
              Claim &amp; costs
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Txt("Claim #", "claimNumber")}
              {Txt("Carrier", "insuranceCarrier")}
              <div>
                <MicroLabel>Repair vendor</MicroLabel>
                <select
                  value={f.vendorId}
                  onChange={(e) => set("vendorId", e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
                >
                  <option value="">Not assigned</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              {Txt("Deductible $", "deductible")}
              {Txt("Estimate $", "estimatedCost")}
              {Txt("Actual cost $", "actualCost")}
              {Txt("Insurance paid $", "insurancePayout")}
              {Txt("Renter owes $", "driverResponsibleAmount")}
            </div>
            <p className="text-xs text-muted-foreground">
              &ldquo;Renter owes&rdquo; is offered as a deduction when their deposit is settled.
            </p>
          </div>

          <div>
            <MicroLabel>Internal notes</MicroLabel>
            <textarea
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="p-4 border-t border-[#EDEDF0] flex justify-end gap-2 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Sel({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<readonly [string, string]>;
}) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white capitalize"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
