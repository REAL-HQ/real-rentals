import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, ShieldAlert } from "lucide-react";
import { EmptyState } from "./ui";
import { createIncidentBoard, listIncidentBoard, setIncidentBoardStatus } from "@/lib/incident-board.functions";
import {
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  incidentStatusLabel,
  incidentTypeLabel,
  type IncidentBoardRow,
  type IncidentStatus,
  type IncidentType,
} from "@/lib/incident-board";

type VehicleChoice = { id: string; label: string };

export function IncidentBoard() {
  const fetchList = useServerFn(listIncidentBoard);
  const create = useServerFn(createIncidentBoard);
  const saveStatus = useServerFn(setIncidentBoardStatus);
  const [rows, setRows] = useState<IncidentBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleChoice[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [incidentType, setIncidentType] = useState<IncidentType>("accident");
  const [occurredAt, setOccurredAt] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetchList();
      setRows(res.rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the Incident Board");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!logging) return;
    void supabase
      .from("vehicles")
      .select("id,unit_number,year,make,model,license_plate")
      .is("archived_at", null)
      .order("unit_number")
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          return;
        }
        setVehicles(
          (data ?? []).map((row) => {
            const name = [row.year, row.make, row.model].filter(Boolean).join(" ");
            const label = [row.unit_number ? `Unit ${row.unit_number}` : null, name || null, row.license_plate || null].filter(Boolean).join(" · ");
            return { id: row.id, label: label || "Vehicle" };
          }),
        );
      });
  }, [logging]);

  const open = rows.find((row) => row.id === openId) ?? null;

  async function submit() {
    setBusy(true);
    try {
      await create({
        data: {
          vehicleId,
          incidentType,
          occurredAt: new Date(occurredAt).toISOString(),
          location,
          description,
        },
      });
      toast.success("Incident logged");
      setLogging(false);
      setVehicleId("");
      setLocation("");
      setDescription("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not log the incident");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(row: IncidentBoardRow, status: IncidentStatus) {
    if (status === row.status) return;
    setBusy(true);
    try {
      await saveStatus({ data: { id: row.id, status } });
      toast.success(`Marked ${incidentStatusLabel(status)}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="admin-sticky-bar flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{rows.length} open</p>
        <button
          type="button"
          onClick={() => setLogging((value) => !value)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Log Incident
        </button>
      </div>

      {logging && (
        <form
          className="rounded-xl border border-[#EDEDF0] bg-white p-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2 className="text-sm font-semibold">Log Incident</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Vehicle</span>
              <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm" required>
                <option value="">Choose a Vehicle</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Type</span>
              <select value={incidentType} onChange={(event) => setIncidentType(event.target.value as IncidentType)} className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm">
                {INCIDENT_TYPES.map((type) => (
                  <option key={type} value={type}>{incidentTypeLabel(type)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">When</span>
              <input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm" required />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Location</span>
              <input value={location} onChange={(event) => setLocation(event.target.value)} className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm" />
          </label>
          <button type="submit" disabled={busy} className="rounded-md bg-black px-3 py-1.5 text-sm text-white disabled:opacity-40">Save Incident</button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ShieldAlert className="w-6 h-6" strokeWidth={1.75} />} title="No Open Incidents" hint="Log an accident, damage, or breakdown. Closed and Written Off incidents stay off this board." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[#FAFAFB] text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Car</th>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Roadside</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">{row.vehicle}</td>
                  <td className="px-3 py-2">{row.driver}</td>
                  <td className="px-3 py-2">{row.typeLabel}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.occurredEt}</td>
                  <td className="px-3 py-2">{row.statusLabel}</td>
                  <td className="px-3 py-2">{row.roadside}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setOpenId(row.id === openId ? null : row.id)} className="text-xs font-semibold text-[#D03020]">
                      {row.id === openId ? "Hide" : "Open"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <section className="rounded-xl border border-[#EDEDF0] bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold">{open.typeLabel} · {open.vehicle}</h2>
          <dl className="grid gap-2 sm:grid-cols-2 text-sm">
            <Fact label="Driver" value={open.driver} />
            <Fact label="Date" value={open.occurredEt} />
            <Fact label="Reported" value={open.reportedEt} />
            <Fact label="Status" value={open.statusLabel} />
            <Fact label="Roadside" value={open.roadside} />
            <Fact label="Location" value={open.location} />
            <Fact label="Severity" value={open.severity} />
            <Fact label="Fault" value={open.fault} />
            <Fact label="Injuries" value={open.injuries} />
            <Fact label="Drivable" value={open.drivable} />
            <Fact label="Police Report" value={open.policeReport} />
            <Fact label="Other Party" value={open.otherParty} />
          </dl>
          <Fact label="Description" value={open.description} />
          <Fact label="Notes" value={open.notes} />
          <label className="block text-sm max-w-xs">
            <span className="mb-1 block text-xs text-muted-foreground">Status</span>
            <select
              value={open.status}
              disabled={busy}
              onChange={(event) => void changeStatus(open, event.target.value as IncidentStatus)}
              className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
            >
              {INCIDENT_STATUSES.map((status) => (
                <option key={status} value={status}>{incidentStatusLabel(status)}</option>
              ))}
            </select>
          </label>
        </section>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
