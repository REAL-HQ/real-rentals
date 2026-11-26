import { useState } from "react";
import { FileUploader } from "@/components/FileUploader";
import { uploadApplicantFile } from "@/lib/applicant-upload";
import { additionalDriverAgeBlock, type AdditionalDriverInput } from "@/lib/additional-drivers";

const empty = (): AdditionalDriverInput => ({
  name: "", email: "", phone: "", dob: "", licenseNumber: "", licenseState: "", licenseExpiration: "", licensePhotoPath: null, relationship: "", smsConsent: false,
});

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * Optional application question. Leaving it blank does not block the primary application.
 */
export function AdditionalDriversQuestion({
  token,
  onDrivers,
  initialOpen = false,
  initialDrivers,
}: {
  token: string;
  onDrivers: (drivers: AdditionalDriverInput[]) => void;
  initialOpen?: boolean;
  initialDrivers?: AdditionalDriverInput[];
}) {
  const [open, setOpen] = useState(initialOpen);
  const [drivers, setDrivers] = useState<AdditionalDriverInput[]>(initialDrivers?.length ? initialDrivers : [empty()]);

  function commit(next: AdditionalDriverInput[], showing: boolean) {
    setDrivers(next);
    setOpen(showing);
    onDrivers(showing ? next.filter((d) => d.name.trim()) : []);
  }

  async function uploadLicense(index: number, file: File) {
    const stored = await uploadApplicantFile({ token, kind: "license", file });
    const next = drivers.map((d, i) => i === index ? { ...d, licensePhotoPath: stored.path } : d);
    commit(next, true);
  }

  const ageNote = open ? drivers.map((d) => d.dob ? additionalDriverAgeBlock(d.dob, todayEt()) : null).find(Boolean) : null;

  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-sm font-semibold text-foreground">Will anyone else drive this car? Add them here and we'll screen them too.</p>
      <p className="mt-1 text-[13px] text-muted-foreground">Optional. Each person must be at least 23, with a valid driver's license. They apply, get approved, and sign before they drive.</p>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={open} onChange={(e) => commit(drivers, e.target.checked)} />
        Yes, someone else will drive
      </label>
      {open ? drivers.map((driver, index) => (
        <div key={index} className="mt-3 space-y-2 rounded-lg border border-border p-3">
          <input className="w-full min-h-11 rounded-lg border border-border px-3 text-base" placeholder="Full legal name" value={driver.name} onChange={(e) => commit(drivers.map((d, i) => i === index ? { ...d, name: e.target.value } : d), true)} />
          <input className="w-full min-h-11 rounded-lg border border-border px-3 text-base" placeholder="Email" value={driver.email} onChange={(e) => commit(drivers.map((d, i) => i === index ? { ...d, email: e.target.value } : d), true)} />
          <input className="w-full min-h-11 rounded-lg border border-border px-3 text-base" placeholder="Phone" value={driver.phone} onChange={(e) => commit(drivers.map((d, i) => i === index ? { ...d, phone: e.target.value } : d), true)} />
          <label className="block text-xs text-muted-foreground">Date of Birth
            <input type="date" className="mt-1 w-full min-h-11 rounded-lg border border-border px-3 text-base" value={driver.dob} onChange={(e) => commit(drivers.map((d, i) => i === index ? { ...d, dob: e.target.value } : d), true)} />
          </label>
          <div className="grid grid-cols-[1fr_4rem] gap-2">
            <input className="min-h-11 rounded-lg border border-border px-3 text-base" placeholder="License number" value={driver.licenseNumber} onChange={(e) => commit(drivers.map((d, i) => i === index ? { ...d, licenseNumber: e.target.value } : d), true)} />
            <input className="min-h-11 rounded-lg border border-border px-3 text-base" placeholder="State" maxLength={2} value={driver.licenseState} onChange={(e) => commit(drivers.map((d, i) => i === index ? { ...d, licenseState: e.target.value.toUpperCase() } : d), true)} />
          </div>
          <label className="block text-xs text-muted-foreground">License Expiration
            <input type="date" className="mt-1 w-full min-h-11 rounded-lg border border-border px-3 text-base" value={driver.licenseExpiration} onChange={(e) => commit(drivers.map((d, i) => i === index ? { ...d, licenseExpiration: e.target.value } : d), true)} />
          </label>
          <input className="w-full min-h-11 rounded-lg border border-border px-3 text-base" placeholder="Relationship to you" value={driver.relationship} onChange={(e) => commit(drivers.map((d, i) => i === index ? { ...d, relationship: e.target.value } : d), true)} />
          <FileUploader
            variant="inline"
            accept="image/*,.pdf"
            upload={async (file) => { await uploadLicense(index, file); }}
          />
          <label className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <input type="checkbox" checked={driver.smsConsent} onChange={(e) => commit(drivers.map((d, i) => i === index ? { ...d, smsConsent: e.target.checked } : d), true)} />
            This driver agrees to texts about the car, pickup, and their own signing link. Reply STOP to opt out.
          </label>
        </div>
      )) : null}
      {ageNote ? <p className="mt-2 text-[13px] text-real-red">{ageNote}</p> : null}
    </div>
  );
}
