import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Plus,
  X,
  ClipboardCheck,
  Check,
  Minus,
  AlertTriangle,
  Camera,
  Loader2,
  ArrowLeft,
  Car,
} from "lucide-react";
import { StatusPill, EmptyState, MicroLabel } from "./ui";
import {
  startInspection,
  getInspection,
  setInspectionItem,
  updateInspection,
  completeInspection,
  createConditionUploadUrl,
  confirmConditionUpload,
  type InspectionDetail,
} from "@/lib/inspections.functions";

type Row = {
  id: string;
  vehicle_id: string;
  inspection_type: string;
  status: string;
  odometer: number | null;
  inspector_name: string | null;
  started_at: string;
  completed_at: string | null;
};

type VehicleLite = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
};
type Template = { id: string; name: string; inspection_type: string; is_active: boolean };

const FUEL_LEVELS = [
  { value: "empty", label: "E" },
  { value: "quarter", label: "1/4" },
  { value: "half", label: "1/2" },
  { value: "three_quarter", label: "3/4" },
  { value: "full", label: "F" },
];

export function InspectionsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<VehicleLite[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [i, v, t] = await Promise.all([
      supabase
        .from("inspections")
        .select(
          "id,vehicle_id,inspection_type,status,odometer,inspector_name,started_at,completed_at",
        )
        .order("started_at", { ascending: false })
        .limit(100),
      supabase.from("vehicles").select("id,year,make,model,license_plate").order("make"),
      supabase
        .from("inspection_templates")
        .select("id,name,inspection_type,is_active")
        .eq("is_active", true)
        .order("name"),
    ]);
    if (i.error) toast.error(i.error.message);
    setRows((i.data as any) ?? []);
    setVehicles((v.data as any) ?? []);
    setTemplates((t.data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const vName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return id.slice(0, 8);
    const base = [v.year, v.make, v.model].filter(Boolean).join(" ").trim();
    return v.license_plate ? `${base} · ${v.license_plate}` : base || id.slice(0, 8);
  };

  if (openId) {
    return (
      <InspectionRunner
        id={openId}
        vehicleLabel={vName}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{rows.length} inspection(s)</span>
        <button
          onClick={() => setStarting(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity duration-150"
        >
          <Plus className="w-4 h-4" /> Start Inspection
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="w-6 h-6" strokeWidth={1.75} />}
          title="No Inspections Yet"
          hint="Run a pre-delivery checklist before a vehicle goes out, and a return checklist when it comes back."
        />
      ) : (
        <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm overflow-hidden">
          <ul className="divide-y divide-[#EDEDF0]">
            {rows.map((r) => (
              <li key={r.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{vName(r.vehicle_id)}</span>
                    <StatusPill
                      status={
                        r.status === "passed"
                          ? "active"
                          : r.status === "failed"
                            ? "overdue"
                            : "pending"
                      }
                    >
                      {r.status === "in_progress" ? "In progress" : r.status}
                    </StatusPill>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.inspection_type.replace(/_/g, " ")}
                    {r.odometer ? ` · ${r.odometer.toLocaleString()} mi` : ""}
                    {r.inspector_name ? ` · ${r.inspector_name}` : ""} ·{" "}
                    {new Date(r.completed_at ?? r.started_at).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => setOpenId(r.id)}
                  className="text-sm font-semibold text-[#D03020] shrink-0"
                >
                  {r.status === "in_progress" ? "Continue" : "View"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {starting ? (
        <StartForm
          vehicles={vehicles}
          templates={templates}
          onClose={() => setStarting(false)}
          onStarted={(id) => {
            setStarting(false);
            setOpenId(id);
          }}
        />
      ) : null}
    </div>
  );
}

function StartForm({
  vehicles,
  templates,
  onClose,
  onStarted,
}: {
  vehicles: VehicleLite[];
  templates: Template[];
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const start = useServerFn(startInspection);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [odometer, setOdometer] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!vehicleId) return toast.error("Pick a vehicle.");
    if (!templateId) return toast.error("Pick a checklist.");
    setBusy(true);
    try {
      const odo = Number(odometer.replace(/[^\d]/g, ""));
      const res = await start({
        data: { vehicleId, templateId, odometer: odo > 0 ? odo : null },
      });
      toast.success("Inspection started");
      onStarted(res.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start inspection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#EDEDF0]">
          <h3 className="font-semibold">Start Inspection</h3>
          <button onClick={onClose} className="text-[#55555E] hover:text-[#111114]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <MicroLabel>Vehicle</MicroLabel>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
            >
              {vehicles.length === 0 ? <option value="">No vehicles</option> : null}
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.year, v.make, v.model].filter(Boolean).join(" ")}
                  {v.license_plate ? ` · ${v.license_plate}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <MicroLabel>Checklist</MicroLabel>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
            >
              {templates.length === 0 ? <option value="">No checklists</option> : null}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <MicroLabel>Odometer (optional)</MicroLabel>
            <input
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              inputMode="numeric"
              placeholder="52,140"
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-[#EDEDF0]">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={go}
            disabled={busy}
            className="rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InspectionRunner({
  id,
  vehicleLabel,
  onBack,
}: {
  id: string;
  vehicleLabel: (vehicleId: string) => string;
  onBack: () => void;
}) {
  const fetchOne = useServerFn(getInspection);
  const setItem = useServerFn(setInspectionItem);
  const patch = useServerFn(updateInspection);
  const complete = useServerFn(completeInspection);

  const [data, setData] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetchOne({ data: { id } });
      setData(res);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load inspection");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  const grouped = useMemo(() => {
    const map = new Map<string, InspectionDetail["items"]>();
    for (const it of data?.items ?? []) {
      const list = map.get(it.section) ?? [];
      list.push(it);
      map.set(it.section, list);
    }
    return Array.from(map.entries());
  }, [data]);

  const readOnly = data ? data.status !== "in_progress" : true;
  const pending = (data?.items ?? []).filter((i) => i.result === "pending").length;
  const failed = (data?.items ?? []).filter((i) => i.result === "fail");
  const criticalFails = failed.filter((i) => i.is_critical);

  async function mark(itemId: string, result: string) {
    if (readOnly) return;
    // Optimistic: the checklist has to feel instant on a phone in the lot.
    setData((p) =>
      p ? { ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, result } : i)) } : p,
    );
    try {
      await setItem({ data: { itemId, result: result as any } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
      load();
    }
  }

  async function finish() {
    setBusy(true);
    try {
      const res = await complete({ data: { id } });
      if (!res.ok) {
        toast.error(`${res.incomplete.length} item(s) still need a result.`);
      } else if (res.status === "failed") {
        toast.error(
          `Inspection failed: ${res.blockedBy.join(", ")}. Vehicle moved to maintenance.`,
        );
      } else {
        toast.success("Inspection passed — vehicle is cleared to go out.");
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not complete inspection");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-[#55555E] hover:text-[#111114]"
      >
        <ArrowLeft className="w-4 h-4" /> All inspections
      </button>

      <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4 text-[#55555E]" />
              <h2 className="font-semibold">{vehicleLabel(data.vehicle_id)}</h2>
              <StatusPill
                status={
                  data.status === "passed"
                    ? "active"
                    : data.status === "failed"
                      ? "overdue"
                      : "pending"
                }
              >
                {data.status === "in_progress" ? "In progress" : data.status}
              </StatusPill>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.inspection_type.replace(/_/g, " ")} · started{" "}
              {new Date(data.started_at).toLocaleString()}
            </p>
          </div>
          {!readOnly ? (
            <button
              onClick={finish}
              disabled={busy}
              className="rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {busy ? "Finishing…" : "Complete Inspection"}
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <MicroLabel>Odometer</MicroLabel>
            <input
              defaultValue={data.odometer ?? ""}
              disabled={readOnly}
              inputMode="numeric"
              onBlur={async (e) => {
                const n = Number(e.target.value.replace(/[^\d]/g, ""));
                await patch({ data: { id, odometer: n > 0 ? n : null } });
              }}
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm disabled:bg-[#F6F6F8]"
            />
          </div>
          <div className="col-span-2">
            <MicroLabel>Fuel level</MicroLabel>
            <div className="mt-1.5 flex gap-1">
              {FUEL_LEVELS.map((fl) => (
                <button
                  key={fl.value}
                  disabled={readOnly}
                  onClick={async () => {
                    setData((p) => (p ? { ...p, fuel_level: fl.value } : p));
                    await patch({ data: { id, fuelLevel: fl.value as any } });
                  }}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium disabled:opacity-50 ${
                    data.fuel_level === fl.value
                      ? "border-[#D03020] bg-[#D03020] text-white"
                      : "border-[#EDEDF0]"
                  }`}
                >
                  {fl.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <MicroLabel>Remaining</MicroLabel>
            <div className="mt-1.5 rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm">
              {pending} item{pending === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {criticalFails.length ? (
          <div className="mt-4 rounded-xl border border-[#F3C9C4] bg-[#FDF2F1] p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#D03020] shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-[#8A1C10]">This vehicle should not go out</div>
              <p className="text-[#8A1C10]/80">{criticalFails.map((i) => i.label).join(" · ")}</p>
            </div>
          </div>
        ) : null}
      </div>

      {grouped.map(([section, items]) => (
        <div
          key={section}
          className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm overflow-hidden"
        >
          <div className="px-4 py-2.5 border-b border-[#EDEDF0] bg-[#FAFAFB]">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#55555E]">
              {section}
            </h3>
          </div>
          <ul className="divide-y divide-[#EDEDF0]">
            {items.map((it) => (
              <li key={it.id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm">
                    {it.label}
                    {it.is_critical ? (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase text-[#D03020]">
                        critical
                      </span>
                    ) : null}
                  </div>
                  {it.requires_photo ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-1">
                      <Camera className="w-3 h-3" /> photo recommended
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-1 shrink-0">
                  <ResultButton
                    active={it.result === "pass"}
                    tone="pass"
                    disabled={readOnly}
                    onClick={() => mark(it.id, "pass")}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </ResultButton>
                  <ResultButton
                    active={it.result === "fail"}
                    tone="fail"
                    disabled={readOnly}
                    onClick={() => mark(it.id, "fail")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </ResultButton>
                  <ResultButton
                    active={it.result === "na"}
                    tone="na"
                    disabled={readOnly}
                    onClick={() => mark(it.id, "na")}
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </ResultButton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {data.inspection_type === "pre_delivery" && readOnly ? (
        <div
          className={`rounded-2xl border bg-white shadow-sm p-4 ${
            data.driver_signed_at ? "border-[#CDE7D6]" : "border-[#F0DCBB]"
          }`}
        >
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">Renter sign-off</h3>
            <StatusPill status={data.driver_signed_at ? "active" : "pending"}>
              {data.driver_signed_at ? "signed" : "awaiting signature"}
            </StatusPill>
          </div>
          {data.driver_signed_at ? (
            <p className="mt-1 text-sm text-[#55555E]">
              Signed by <strong>{data.driver_signature_name}</strong> on{" "}
              {new Date(data.driver_signed_at).toLocaleString()}.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              The renter has not yet agreed to this condition record. It appears in their portal
              under Pictures.
            </p>
          )}
          {data.driver_notes ? (
            <div className="mt-2 rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] p-3 text-sm">
              <span className="font-medium">Renter noted:</span> {data.driver_notes}
            </div>
          ) : null}
        </div>
      ) : null}

      <ConditionUploader
        vehicleId={data.vehicle_id}
        inspectionId={data.id}
        rentalId={data.rental_id}
        phase={data.inspection_type === "return" ? "checkin" : "checkout"}
        media={data.media}
        readOnly={readOnly}
        onChanged={load}
      />
    </div>
  );
}

function ResultButton({
  active,
  tone,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  tone: "pass" | "fail" | "na";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeClass =
    tone === "pass"
      ? "border-[#1F8A4C] bg-[#1F8A4C] text-white"
      : tone === "fail"
        ? "border-[#D03020] bg-[#D03020] text-white"
        : "border-[#9A9AA3] bg-[#9A9AA3] text-white";
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50 ${
        active ? activeClass : "border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Shared before/after photo uploader. Used inside an inspection here, and by
 * the driver portal on its own.
 */
export function ConditionUploader({
  vehicleId,
  inspectionId,
  rentalId,
  phase,
  media,
  readOnly,
  onChanged,
  title = "Condition Photos",
}: {
  vehicleId: string;
  inspectionId?: string | null;
  rentalId?: string | null;
  phase: "checkout" | "checkin" | "damage" | "other";
  media: Array<{
    id: string;
    url: string | null;
    angle: string | null;
    phase: string;
    media_type: string;
    captured_by_role: string;
    created_at: string;
  }>;
  readOnly?: boolean;
  onChanged: () => void;
  title?: string;
}) {
  const startUpload = useServerFn(createConditionUploadUrl);
  const confirm = useServerFn(confirmConditionUpload);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [angle, setAngle] = useState("front");

  async function handleFiles(files: FileList) {
    setUploading(true);
    let done = 0;
    for (const file of Array.from(files)) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error(`${file.name} is over 50MB.`);
        continue;
      }
      try {
        const { path, token, bucket } = await startUpload({
          data: { vehicleId, fileName: file.name, mimeType: file.type || "image/jpeg" },
        });
        const { error } = await supabase.storage
          .from(bucket)
          .uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
        if (error) throw error;
        await confirm({
          data: {
            vehicleId,
            rentalId: rentalId ?? null,
            inspectionId: inspectionId ?? null,
            phase,
            angle: angle as any,
            path,
            fileName: file.name,
            mimeType: file.type || undefined,
            sizeBytes: file.size,
          },
        });
        done++;
      } catch (e: any) {
        console.error("[condition-upload] failed", e);
        toast.error(e?.message ?? `Could not upload ${file.name}`);
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (done) {
      toast.success(`${done} file${done === 1 ? "" : "s"} uploaded`);
      onChanged();
    }
  }

  const ANGLES = [
    ["front", "Front"],
    ["rear", "Rear"],
    ["driver_side", "Driver side"],
    ["passenger_side", "Passenger side"],
    ["interior_front", "Interior front"],
    ["interior_rear", "Interior rear"],
    ["odometer", "Odometer"],
    ["fuel", "Fuel"],
    ["damage", "Damage"],
    ["other", "Other"],
  ];

  return (
    <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm p-4">
      <h3 className="font-semibold text-sm">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Photos and video are timestamped proof of condition. Capture the same angles at pickup and
        return.
      </p>

      {!readOnly ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {ANGLES.map(([value, label]) => (
              <button
                key={value}
                onClick={() => setAngle(value)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  angle === value
                    ? "border-[#D03020] bg-[#D03020] text-white"
                    : "border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3 rounded-lg border border-dashed border-[#EDEDF0] p-4 cursor-pointer hover:border-[#D03020]/60">
            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/mp4,video/quicktime"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files;
                if (f && f.length) handleFiles(f);
              }}
            />
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Camera className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="text-sm text-muted-foreground">
              {uploading
                ? "Uploading…"
                : `Add ${ANGLES.find((a) => a[0] === angle)?.[1]} photo or video`}
            </span>
          </label>
        </div>
      ) : null}

      {media.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No photos yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {media.map((m) => (
            <a
              key={m.id}
              href={m.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="group block overflow-hidden rounded-xl border border-[#EDEDF0]"
            >
              {m.media_type === "video" ? (
                <div className="h-28 w-full bg-[#F6F6F8] flex items-center justify-center text-xs text-muted-foreground">
                  Video
                </div>
              ) : (
                <img
                  src={m.url ?? ""}
                  alt={m.angle ?? "condition photo"}
                  loading="lazy"
                  className="h-28 w-full object-cover transition-transform group-hover:scale-[1.03]"
                />
              )}
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground truncate">
                {(m.angle ?? "photo").replace(/_/g, " ")} · {m.captured_by_role}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
