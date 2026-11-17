import { AppSelect } from "@/components/ui/app-select";
import { FileUploader } from "@/components/FileUploader";
import { MAX_INTAKE_PHOTOS } from "@/lib/partner-portal";

export const TITLE_STATUSES = ["Clean", "Salvage", "Rebuilt", "Not sure"];
export const LIEN_STATUSES = ["Owned free and clear", "Financed — still making payments"];
export const CONDITIONS = ["Excellent", "Good", "Fair"];
export const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

// Owned option labels only; submitted strings and state abbreviations stay exact.
const OPTION_LABELS: Readonly<Record<string, string>> = {
  "Not sure": "Not Sure",
  "Owned free and clear": "Owned Free And Clear",
  "Financed — still making payments": "Financed — Still Making Payments",
};

export type VehicleFormState = {
  vin: string; year: string; make: string; model: string; trim: string; color: string; license_plate: string;
  mileage: string; title_status: string; lien_status: string; registration_state: string;
  currently_insured: string; condition: string; message: string;
};

export const EMPTY_VEHICLE: VehicleFormState = {
  vin: "", year: "", make: "", model: "", trim: "", color: "", license_plate: "", mileage: "",
  title_status: "", lien_status: "", registration_state: "", currently_insured: "", condition: "", message: "",
};

export type VehicleFiles = { photos: File[]; registration: File[]; idDocument: File[] };
export const EMPTY_FILES: VehicleFiles = { photos: [], registration: [], idDocument: [] };

export function validateVehicle(v: VehicleFormState): Partial<Record<keyof VehicleFormState, string>> {
  const e: Partial<Record<keyof VehicleFormState, string>> = {};
  const vin = v.vin.trim();
  if (!vin) e.vin = "Required";
  else if (vin.length !== 17) e.vin = "VIN must be 17 characters";
  else if (/[IOQ]/i.test(vin) || !/^[A-Z0-9]{17}$/i.test(vin)) e.vin = "VINs use letters and numbers only, never I, O or Q";
  if (!v.year.trim()) e.year = "Required";
  else if (!/^\d{4}$/.test(v.year) || Number(v.year) < 1980 || Number(v.year) > new Date().getFullYear() + 2) e.year = "Enter a 4-digit year";
  if (!v.make.trim()) e.make = "Required";
  if (!v.model.trim()) e.model = "Required";
  return e;
}

export function vehiclePayload(v: VehicleFormState) {
  return {
    vin: v.vin.trim().toUpperCase(),
    year: Number(v.year),
    make: v.make.trim(),
    model: v.model.trim(),
    trim: v.trim.trim() || null,
    color: v.color.trim() || null,
    license_plate: v.license_plate.trim().toUpperCase() || null,
    mileage: v.mileage ? Number(v.mileage) : null,
    title_status: v.title_status || null,
    lien_status: v.lien_status || null,
    registration_state: v.registration_state || null,
    currently_insured: v.currently_insured === "" ? null : v.currently_insured === "Yes",
    condition: v.condition || null,
    message: v.message.trim() || null,
  };
}

export function filesPayload(f: VehicleFiles) {
  const list = [
    ...f.photos.map((file) => ({ kind: "photo" as const, file })),
    ...f.registration.map((file) => ({ kind: "registration" as const, file })),
    ...f.idDocument.map((file) => ({ kind: "id_document" as const, file })),
  ];
  return { list, meta: list.map(({ kind, file }) => ({ kind, name: file.name, type: file.type || "application/octet-stream", size: file.size })) };
}

export function PartnerVehicleFields({
  value, onChange, errors, files, onFiles, disabled, showIdUpload = true,
}: {
  value: VehicleFormState;
  onChange: (next: VehicleFormState) => void;
  errors: Partial<Record<keyof VehicleFormState, string>>;
  files: VehicleFiles;
  onFiles: (next: VehicleFiles) => void;
  disabled?: boolean;
  showIdUpload?: boolean;
}) {
  const set = <K extends keyof VehicleFormState>(k: K, v: VehicleFormState[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      <Field label="VIN (17 Characters)" value={value.vin} onChange={(v) => set("vin", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17))} error={errors.vin} />
      <Field label="Year" value={value.year} onChange={(v) => set("year", v.replace(/\D/g, "").slice(0, 4))} error={errors.year} inputMode="numeric" />
      <Field label="Make" value={value.make} onChange={(v) => set("make", v)} error={errors.make} />
      <Field label="Model" value={value.model} onChange={(v) => set("model", v)} error={errors.model} />
      <Field label="Trim (Optional)" value={value.trim} onChange={(v) => set("trim", v)} />
      <Field label="Color (Optional)" value={value.color} onChange={(v) => set("color", v)} />
      <Field label="License Plate (Optional)" value={value.license_plate} onChange={(v) => set("license_plate", v.toUpperCase().slice(0, 12))} />
      <Field label="Current Mileage" value={value.mileage} onChange={(v) => set("mileage", v.replace(/\D/g, "").slice(0, 7))} inputMode="numeric" />
      <Select label="Title Status" value={value.title_status} onChange={(v) => set("title_status", v)} options={TITLE_STATUSES} />
      <Select label="Lien Status" value={value.lien_status} onChange={(v) => set("lien_status", v)} options={LIEN_STATUSES} />
      <Select label="Registration State" value={value.registration_state} onChange={(v) => set("registration_state", v)} options={US_STATES} />
      <Select label="Currently Insured" value={value.currently_insured} onChange={(v) => set("currently_insured", v)} options={["Yes", "No"]} />
      <Select label="Vehicle Condition" value={value.condition} onChange={(v) => set("condition", v)} options={CONDITIONS} />

      <div className="md:col-span-2">
        <label className="text-[10px] tracking-wider text-muted-foreground">Vehicle Photos (Front, Back, Both Sides, Interior, Odometer)</label>
        <div className="mt-1">
          <FileUploader value={files.photos} disabled={disabled} onChange={(photos) => onFiles({ ...files, photos })}
            accept="image/*" multiple maxFiles={MAX_INTAKE_PHOTOS} title="Drop Vehicle Photos Here" label="Browse Photos"
            hint={`${files.photos.length}/${MAX_INTAKE_PHOTOS} selected`} />
        </div>
      </div>
      <div>
        <label className="text-[10px] tracking-wider text-muted-foreground">Registration (Photo Or PDF)</label>
        <div className="mt-1">
          <FileUploader value={files.registration} disabled={disabled} onChange={(registration) => onFiles({ ...files, registration })}
            accept="image/*,application/pdf" maxFiles={1} variant="inline" label="Upload Registration" hint="Kept private. Only our team sees it." />
        </div>
      </div>
      {showIdUpload && (
        <div>
          <label className="text-[10px] tracking-wider text-muted-foreground">Driver's License Or ID (Optional)</label>
          <div className="mt-1">
            <FileUploader value={files.idDocument} disabled={disabled} onChange={(idDocument) => onFiles({ ...files, idDocument })}
              accept="image/*,application/pdf" maxFiles={1} variant="inline" label="Upload ID" hint="Kept private. Used to confirm the owner on the title." />
          </div>
        </div>
      )}
      <div className="md:col-span-2">
        <label className="text-[10px] tracking-wider text-muted-foreground">Anything We Should Know? (Optional)</label>
        <textarea value={value.message} onChange={(e) => set("message", e.target.value)} rows={3}
          className="mt-1 w-full bg-soft rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
      </div>
    </>
  );
}

export function Field({ label, value, onChange, type = "text", error, inputMode, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; error?: string;
  inputMode?: "numeric" | "text" | "email"; autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] tracking-wider text-muted-foreground">{label}</span>
      <input type={type} value={value} inputMode={inputMode} autoComplete={autoComplete} aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full bg-soft rounded-lg px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 ${error ? "ring-2 ring-real-red/40" : ""}`} />
      {error && <span className="mt-1 block text-xs text-real-red">{error}</span>}
    </label>
  );
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="text-[10px] tracking-wider text-muted-foreground">{label}</span>
      <AppSelect aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-auto w-full rounded-lg border-border bg-soft px-5 py-3 text-sm text-foreground">
        <option value="">Select…</option>
        {options.map((option) => <option key={option} value={option}>{OPTION_LABELS[option] ?? option}</option>)}
      </AppSelect>
    </label>
  );
}
