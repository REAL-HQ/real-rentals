import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CalendarClock, Plus, X, Check, Wrench, Trash2 } from "lucide-react";
import { StatusPill, EmptyState, MicroLabel } from "./ui";

type Schedule = {
  id: string;
  vehicle_id: string;
  item: string;
  category: string;
  interval_miles: number | null;
  interval_days: number | null;
  last_done_on: string | null;
  last_done_miles: number | null;
  next_due_on: string | null;
  next_due_miles: number | null;
  is_active: boolean;
  notes: string | null;
};

type VehicleLite = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
  current_odometer: number | null;
};

type Vendor = { id: string; name: string; vendor_type: string };

/**
 * The service items most small rideshare fleets track. Used to seed a new
 * vehicle in one click rather than typing five schedules by hand.
 */
export const STANDARD_SCHEDULE: Array<{
  item: string;
  category: string;
  interval_miles: number | null;
  interval_days: number | null;
}> = [
  { item: "Oil change", category: "routine", interval_miles: 5000, interval_days: 180 },
  { item: "Tire rotation", category: "routine", interval_miles: 6000, interval_days: 180 },
  { item: "Brake inspection", category: "safety", interval_miles: 12000, interval_days: 365 },
  { item: "Air filter", category: "routine", interval_miles: 15000, interval_days: 365 },
  { item: "Transmission service", category: "routine", interval_miles: 30000, interval_days: 730 },
  {
    item: "State inspection / registration",
    category: "compliance",
    interval_miles: null,
    interval_days: 365,
  },
];

export type DueState = { due: boolean; soon: boolean; reasons: string[] };

/**
 * Work out whether a schedule is due, or close to it, from both the calendar
 * and the odometer. Either axis can trip it — an oil change is due at 5,000
 * miles OR six months, whichever lands first.
 */
export function scheduleDueState(s: Schedule, odometer: number | null): DueState {
  const reasons: string[] = [];
  let due = false;
  let soon = false;

  if (s.next_due_on) {
    const days = Math.round((new Date(s.next_due_on).getTime() - Date.now()) / 86400000);
    if (days < 0) {
      due = true;
      reasons.push(`${Math.abs(days)}d overdue`);
    } else if (days <= 14) {
      soon = true;
      reasons.push(`due in ${days}d`);
    }
  }

  if (s.next_due_miles != null && odometer != null && odometer > 0) {
    const left = s.next_due_miles - odometer;
    if (left <= 0) {
      due = true;
      reasons.push(`${Math.abs(left).toLocaleString()} mi over`);
    } else if (left <= 500) {
      soon = true;
      reasons.push(`${left.toLocaleString()} mi left`);
    }
  }

  return { due, soon, reasons };
}

export function MaintenanceSchedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [vehicles, setVehicles] = useState<VehicleLite[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ vehicleId: string; schedule: Schedule | null } | null>(
    null,
  );
  const [completing, setCompleting] = useState<Schedule | null>(null);
  const [seeding, setSeeding] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [s, v, vd] = await Promise.all([
      supabase.from("maintenance_schedules").select("*").order("item"),
      supabase
        .from("vehicles")
        .select("id,year,make,model,license_plate,current_odometer")
        .neq("status", "retired")
        .order("make"),
      supabase.from("vendors").select("id,name,vendor_type").eq("is_active", true).order("name"),
    ]);
    if (s.error) toast.error(s.error.message);
    setSchedules((s.data as any) ?? []);
    setVehicles((v.data as any) ?? []);
    setVendors((vd.data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const byVehicle = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    for (const s of schedules) {
      const list = map.get(s.vehicle_id) ?? [];
      list.push(s);
      map.set(s.vehicle_id, list);
    }
    return map;
  }, [schedules]);

  const dueCount = useMemo(
    () =>
      schedules.filter((s) => {
        const v = vehicles.find((x) => x.id === s.vehicle_id);
        return s.is_active && scheduleDueState(s, v?.current_odometer ?? null).due;
      }).length,
    [schedules, vehicles],
  );

  async function seedStandard(vehicleId: string) {
    setSeeding(vehicleId);
    const existing = new Set((byVehicle.get(vehicleId) ?? []).map((s) => s.item.toLowerCase()));
    const rows = STANDARD_SCHEDULE.filter((s) => !existing.has(s.item.toLowerCase())).map((s) => ({
      vehicle_id: vehicleId,
      item: s.item,
      category: s.category,
      interval_miles: s.interval_miles,
      interval_days: s.interval_days,
    }));
    if (rows.length === 0) {
      setSeeding(null);
      return toast.info("This vehicle already has the standard schedule.");
    }
    const { error } = await supabase.from("maintenance_schedules").insert(rows);
    setSeeding(null);
    if (error) return toast.error(error.message);
    toast.success(`Added ${rows.length} service item(s)`);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this service item?")) return;
    const { error } = await supabase.from("maintenance_schedules").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-[#55555E]" />
          <span className="text-sm font-semibold">Service Schedule</span>
          {dueCount > 0 ? <StatusPill tone="red">{dueCount} due</StatusPill> : null}
        </div>
        <span className="text-xs text-muted-foreground">
          Tracks each vehicle by miles and by date — whichever comes first.
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : vehicles.length === 0 ? (
        <EmptyState
          icon={<Wrench className="w-6 h-6" strokeWidth={1.75} />}
          title="No Vehicles Yet"
          hint="Add a vehicle to start tracking its service schedule."
        />
      ) : (
        <div className="space-y-3">
          {vehicles.map((v) => {
            const items = byVehicle.get(v.id) ?? [];
            const label =
              [v.year, v.make, v.model].filter(Boolean).join(" ").trim() || v.id.slice(0, 8);
            return (
              <div
                key={v.id}
                className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm overflow-hidden"
              >
                <header className="px-5 py-3 border-b border-[#EDEDF0] flex items-center gap-3 flex-wrap">
                  <div className="text-[13px] font-semibold text-[#111114]">
                    {label}
                    {v.license_plate ? (
                      <span className="text-[#9A9AA3] font-normal"> · {v.license_plate}</span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-[#9A9AA3] tabular-nums">
                    {v.current_odometer
                      ? `${v.current_odometer.toLocaleString()} mi`
                      : "no odometer"}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {items.length === 0 ? (
                      <button
                        onClick={() => seedStandard(v.id)}
                        disabled={seeding === v.id}
                        className="rounded-md bg-[#111114] text-white px-2.5 py-1 text-[11px] font-medium hover:opacity-90 disabled:opacity-40"
                      >
                        {seeding === v.id ? "Adding…" : "Use standard schedule"}
                      </button>
                    ) : null}
                    <button
                      onClick={() => setEditing({ vehicleId: v.id, schedule: null })}
                      className="inline-flex items-center gap-1 rounded-md border border-[#EDEDF0] px-2.5 py-1 text-[11px] font-medium text-[#55555E] hover:border-[#D6D6DB]"
                    >
                      <Plus className="w-3 h-3" /> Item
                    </button>
                  </div>
                </header>

                {items.length === 0 ? (
                  <div className="px-5 py-4 text-[12px] text-[#9A9AA3]">
                    No service items yet. Use the standard schedule to add oil, tires, brakes and
                    registration.
                  </div>
                ) : (
                  <ul className="divide-y divide-[#F4F4F6]">
                    {items.map((s) => {
                      const state = scheduleDueState(s, v.current_odometer);
                      return (
                        <li key={s.id} className="px-5 py-2.5 flex items-center gap-3 flex-wrap">
                          <div className="min-w-[160px] flex-1">
                            <div className="text-[13px] text-[#111114]">{s.item}</div>
                            <div className="text-[11px] text-[#9A9AA3]">
                              every{" "}
                              {[
                                s.interval_miles ? `${s.interval_miles.toLocaleString()} mi` : null,
                                s.interval_days ? `${s.interval_days} days` : null,
                              ]
                                .filter(Boolean)
                                .join(" / ")}
                              {s.last_done_on ? ` · last ${s.last_done_on}` : " · never done"}
                            </div>
                          </div>

                          {state.due ? (
                            <StatusPill tone="red">Due</StatusPill>
                          ) : state.soon ? (
                            <StatusPill tone="amber">Soon</StatusPill>
                          ) : (
                            <StatusPill tone="green">OK</StatusPill>
                          )}

                          <div className="text-[11px] text-[#9A9AA3] tabular-nums min-w-[130px] text-right">
                            {state.reasons.length
                              ? state.reasons.join(" · ")
                              : s.next_due_on
                                ? `due ${s.next_due_on}`
                                : s.next_due_miles
                                  ? `due ${s.next_due_miles.toLocaleString()} mi`
                                  : "—"}
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setCompleting(s)}
                              className="inline-flex items-center gap-1 rounded-md bg-[#111114] text-white px-2.5 py-1 text-[11px] font-medium hover:opacity-90"
                            >
                              <Check className="w-3 h-3" /> Mark done
                            </button>
                            <button
                              onClick={() => setEditing({ vehicleId: v.id, schedule: s })}
                              className="text-[11px] font-semibold text-[#D03020] px-2 py-1"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => remove(s.id)}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#55555E] hover:text-[#D03020]"
                              title="Delete item"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing ? (
        <ScheduleForm
          vehicleId={editing.vehicleId}
          schedule={editing.schedule}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}

      {completing ? (
        <CompleteForm
          schedule={completing}
          vehicle={vehicles.find((v) => v.id === completing.vehicle_id) ?? null}
          vendors={vendors}
          onClose={() => setCompleting(null)}
          onSaved={() => {
            setCompleting(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#EDEDF0]">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-[#55555E] hover:text-[#111114]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function ScheduleForm({
  vehicleId,
  schedule,
  onClose,
  onSaved,
}: {
  vehicleId: string;
  schedule: Schedule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [item, setItem] = useState(schedule?.item ?? "");
  const [category, setCategory] = useState(schedule?.category ?? "routine");
  const [miles, setMiles] = useState(schedule?.interval_miles?.toString() ?? "");
  const [days, setDays] = useState(schedule?.interval_days?.toString() ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (item.trim().length < 2) return toast.error("Name the service item.");
    const m = Number(miles.replace(/[^\d]/g, ""));
    const d = Number(days.replace(/[^\d]/g, ""));
    if (!m && !d) return toast.error("Set a mileage interval, a time interval, or both.");
    setBusy(true);
    const payload = {
      vehicle_id: vehicleId,
      item: item.trim(),
      category,
      interval_miles: m || null,
      interval_days: d || null,
    };
    const { error } = schedule
      ? await supabase.from("maintenance_schedules").update(payload).eq("id", schedule.id)
      : await supabase.from("maintenance_schedules").insert(payload);
    setBusy(false);
    if (error) {
      return toast.error(
        error.message.includes("maintenance_schedules_vehicle_item_idx")
          ? "That service item already exists for this vehicle."
          : error.message,
      );
    }
    toast.success("Saved");
    onSaved();
  }

  return (
    <Modal title={schedule ? "Edit Service Item" : "Add Service Item"} onClose={onClose}>
      <div>
        <MicroLabel>Item</MicroLabel>
        <input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="Oil change"
          className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
        />
      </div>
      <div>
        <MicroLabel>Category</MicroLabel>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
        >
          {["routine", "safety", "compliance", "repair"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <MicroLabel>Every (miles)</MicroLabel>
          <input
            value={miles}
            onChange={(e) => setMiles(e.target.value)}
            inputMode="numeric"
            placeholder="5000"
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <MicroLabel>Every (days)</MicroLabel>
          <input
            value={days}
            onChange={(e) => setDays(e.target.value)}
            inputMode="numeric"
            placeholder="180"
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Fill in either or both — whichever comes first marks the item due.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function CompleteForm({
  schedule,
  vehicle,
  vendors,
  onClose,
  onSaved,
}: {
  schedule: Schedule;
  vehicle: VehicleLite | null;
  vendors: Vendor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [performedOn, setPerformedOn] = useState(new Date().toISOString().slice(0, 10));
  const [odometer, setOdometer] = useState(vehicle?.current_odometer?.toString() ?? "");
  const [cost, setCost] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const odo = Number(odometer.replace(/[^\d]/g, ""));
    if (schedule.interval_miles && !odo) {
      return toast.error("This item is tracked by mileage — enter the odometer reading.");
    }
    setBusy(true);

    // Record the work first, then roll the schedule. A database trigger derives
    // the next due date and mileage from these values.
    const { error: recErr } = await supabase.from("maintenance_records").insert({
      vehicle_id: schedule.vehicle_id,
      schedule_id: schedule.id,
      item: schedule.item,
      category: schedule.category,
      status: "completed",
      performed_on: performedOn,
      completed_at: new Date(performedOn).toISOString(),
      odometer: odo || null,
      total_cost: Number(cost.replace(/[^\d.]/g, "")) || 0,
      vendor_id: vendorId || null,
      invoice_number: invoice.trim() || null,
      notes: notes.trim() || null,
    });
    if (recErr) {
      setBusy(false);
      return toast.error(recErr.message);
    }

    const { error: schedErr } = await supabase
      .from("maintenance_schedules")
      .update({ last_done_on: performedOn, last_done_miles: odo || null })
      .eq("id", schedule.id);
    if (schedErr) {
      setBusy(false);
      return toast.error(schedErr.message);
    }

    // Keep the vehicle's odometer moving forward, never backward — a typo on
    // one service entry should not rewrite the vehicle's mileage history.
    if (odo && (!vehicle?.current_odometer || odo > vehicle.current_odometer)) {
      await supabase
        .from("vehicles")
        .update({ current_odometer: odo, odometer_updated_at: new Date().toISOString() })
        .eq("id", schedule.vehicle_id);
    }

    setBusy(false);
    toast.success(`${schedule.item} logged — next service scheduled`);
    onSaved();
  }

  return (
    <Modal title={`Log ${schedule.item}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <MicroLabel>Date performed</MicroLabel>
          <input
            type="date"
            value={performedOn}
            onChange={(e) => setPerformedOn(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <MicroLabel>Odometer</MicroLabel>
          <input
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            inputMode="numeric"
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <MicroLabel>Vendor</MicroLabel>
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
        >
          <option value="">Not recorded</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <MicroLabel>Cost $</MicroLabel>
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            inputMode="decimal"
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <MicroLabel>Invoice #</MicroLabel>
          <input
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <MicroLabel>Notes</MicroLabel>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Log Service"}
        </button>
      </div>
    </Modal>
  );
}
