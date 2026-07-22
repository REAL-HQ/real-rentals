import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  FileText,
  Loader2,
  PhoneCall,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  REQUIRED_DOC_TYPES,
  SCREENING_STATUSES,
  type Application,
  type DriverScreening,
  type LeadDocument,
  type RequiredDocType,
  type ScreeningStatus,
} from "./types";

/* ------------------------------------------------------------------ */
/* Scoring + disqualifier rules                                        */
/* ------------------------------------------------------------------ */

export function computeScreening(s: Partial<DriverScreening>): {
  score: number;
  disqualified: boolean;
  reasons: string[];
} {
  let score = 0;
  if (s.gig_account_status === "active") score += 25;
  if (s.license_active) score += 20;
  if ((s.license_years ?? 0) >= 3) score += 10;
  if (s.has_personal_insurance && s.policy_active) score += 20;
  if ((s.accidents_last_3yr ?? 0) === 0) score += 10;
  if ((s.license_points ?? 0) === 0) score += 5;
  if (s.drive_type === "full_time") score += 5;
  if (s.rate_confirmed && s.card_in_own_name) score += 5;

  const reasons: string[] = [];
  if (s.license_active === false) reasons.push("License Not Active");
  if (s.has_dui === true) reasons.push("DUI On Record");
  if (s.gig_account_status === "deactivated") reasons.push("Gig Account Deactivated");
  if (s.card_in_own_name === false) reasons.push("Payment Card Not In Driver's Name");
  if (s.has_personal_insurance === true && s.insurance_name_matches_license === false) {
    reasons.push("Insurance Name Does Not Match License");
  }
  if (s.driver_age != null && s.driver_age < 21) reasons.push("Driver Under 21");

  return { score: Math.min(100, score), disqualified: reasons.length > 0, reasons };
}

/* ------------------------------------------------------------------ */
/* Data hook                                                           */
/* ------------------------------------------------------------------ */

export function useDriverScreening(leadId: string) {
  const [screening, setScreening] = useState<DriverScreening | null>(null);
  const [docs, setDocs] = useState<LeadDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: s }, { data: d }] = await Promise.all([
      supabase.from("driver_screenings").select("*").eq("lead_id", leadId).maybeSingle(),
      supabase.from("lead_documents").select("*").eq("lead_id", leadId).order("uploaded_at", { ascending: false }),
    ]);
    setScreening(s ?? null);
    setDocs(d ?? []);
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { screening, setScreening, docs, setDocs, loading, reload: load };
}

/* ------------------------------------------------------------------ */
/* Pipeline stepper                                                    */
/* ------------------------------------------------------------------ */

const PIPELINE: { key: ScreeningStatus; label: string }[] = [
  { key: "new_lead", label: "New Lead" },
  { key: "contacted", label: "Contacted" },
  { key: "interview_complete", label: "Interview Complete" },
  { key: "docs_pending", label: "Docs Pending" },
  { key: "insurance_verified", label: "Insurance Verified" },
  { key: "approved", label: "Approved" },
  { key: "pickup_scheduled", label: "Pickup Scheduled" },
  { key: "active_renter", label: "Active Renter" },
];

function statusIndex(s: ScreeningStatus | null | undefined): number {
  const i = PIPELINE.findIndex((p) => p.key === s);
  return i < 0 ? 0 : i;
}

export function ScreeningPipeline({
  screening,
  docs,
  onAdvance,
}: {
  screening: DriverScreening | null;
  docs: LeadDocument[];
  onAdvance: (next: ScreeningStatus) => Promise<void>;
}) {
  const current = (screening?.status ?? "new_lead") as ScreeningStatus;
  const isDq = screening?.disqualified === true || current === "disqualified";
  const activeIdx = statusIndex(current);
  const docCount = new Set(
    docs.filter((d) => REQUIRED_DOC_TYPES.includes(d.doc_type as RequiredDocType)).map((d) => d.doc_type),
  ).size;
  const hasRecording = docs.some((d) => d.doc_type === "verification_recording");

  function attempt(target: ScreeningStatus) {
    const missing: string[] = [];
    if (target !== "new_lead" && target !== "contacted") {
      if (!screening?.interview_completed_at) missing.push("Complete the interview first");
      if (screening?.disqualified) missing.push("Driver is disqualified");
    }
    if (["insurance_verified", "approved", "pickup_scheduled", "active_renter"].includes(target)) {
      if (docCount < 4) missing.push(`Upload all four documents (${docCount}/4)`);
      if (!screening?.insurance_verified) missing.push("Mark insurance verified");
      if (!hasRecording) missing.push("Upload verification call recording");
    }
    if (missing.length > 0) {
      toast.error(`Cannot advance to "${target.replace(/_/g, " ")}"`, {
        description: missing.join(" • "),
      });
      return;
    }
    void onAdvance(target);
  }

  return (
    <div className="rounded-xl border border-border bg-white p-4">
      {isDq && screening?.disqualification_reason && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Disqualified</div>
            <div className="text-xs">{screening.disqualification_reason}</div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {PIPELINE.map((p, i) => {
          const done = !isDq && i < activeIdx;
          const active = !isDq && i === activeIdx;
          const cls = isDq
            ? "bg-gray-100 text-gray-400 border-gray-200"
            : done
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : active
                ? "bg-black text-white border-black"
                : "bg-white text-muted-foreground border-border";
          return (
            <div key={p.key} className="flex items-center">
              <button
                type="button"
                onClick={() => attempt(p.key)}
                title={`Set status to ${p.label}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${cls}`}
              >
                {done ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : active ? (
                  <div className="h-2 w-2 rounded-full bg-white" />
                ) : (
                  <CircleDashed className="h-3 w-3" />
                )}
                {p.label}
              </button>
              {i < PIPELINE.length - 1 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screening badge (for list column)                                   */
/* ------------------------------------------------------------------ */

export function ScreeningBadge({
  screening,
  docCount,
}: {
  screening: Pick<DriverScreening, "qualification_score" | "disqualified"> | null | undefined;
  docCount: number;
}) {
  if (!screening || screening.qualification_score == null) {
    return <span className="text-[11px] text-muted-foreground">Not Screened</span>;
  }
  const score = screening.qualification_score;
  const dq = screening.disqualified;
  const cls = dq
    ? "bg-red-100 text-red-800 border-red-200"
    : score >= 70
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : score >= 40
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : "bg-red-100 text-red-800 border-red-200";
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
        {dq ? <AlertTriangle className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
        {dq ? "DQ" : score}
      </span>
      <span className="text-[10px] text-muted-foreground">{docCount}/4 Docs</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interview Tab                                                       */
/* ------------------------------------------------------------------ */

const GIG_APPS = ["uber", "lyft", "doordash", "instacart", "other"] as const;

export function InterviewTab({
  driver,
  screening,
  onSaved,
}: {
  driver: Application;
  screening: DriverScreening | null;
  onSaved: (next: DriverScreening) => void;
}) {
  const [s, setS] = useState<Partial<DriverScreening>>(
    () =>
      screening ?? {
        lead_id: driver.id,
        gig_apps: [],
        license_state: "FL",
      },
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (screening) setS(screening);
  }, [screening]);

  function up<K extends keyof DriverScreening>(k: K, v: DriverScreening[K] | null) {
    setS((prev) => ({ ...prev, [k]: v }));
  }
  function toggleApp(app: string) {
    const cur = new Set(s.gig_apps ?? []);
    if (cur.has(app)) cur.delete(app);
    else cur.add(app);
    up("gig_apps" as any, Array.from(cur) as any);
  }

  async function completeInterview() {
    setSaving(true);
    try {
      const { score, disqualified, reasons } = computeScreening(s);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const nowIso = new Date().toISOString();
      const nextStatus: ScreeningStatus = disqualified ? "disqualified" : "docs_pending";
      const patch: Partial<DriverScreening> = {
        ...s,
        lead_id: driver.id,
        qualification_score: score,
        disqualified,
        disqualification_reason: disqualified ? reasons.join(", ") : null,
        interview_completed_at: nowIso,
        interviewed_by: user?.email ?? user?.id ?? "back-office",
        status: nextStatus,
      };
      const { data, error } = await supabase
        .from("driver_screenings")
        .upsert(patch as any, { onConflict: "lead_id" })
        .select("*")
        .single();
      if (error) throw error;
      onSaved(data as DriverScreening);
      toast.success(
        disqualified
          ? `Interview Saved — Driver Disqualified (${reasons.length} rule${reasons.length === 1 ? "" : "s"})`
          : `Interview Complete — Score ${score}/100. Advanced To Docs Pending.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save interview");
    } finally {
      setSaving(false);
    }
  }

  const insuranceProvided = s.has_personal_insurance === true;
  const previewScore = computeScreening(s);

  return (
    <div className="space-y-4">
      <ScriptCard title="1. Opening">
        <Script>
          "Hey {driver.full_name?.split(/\s+/)[0] ?? "there"}, this is [You] with REAL RENTALS. You requested info about
          renting a car for rideshare. Got a couple minutes so I can get you set up?"
        </Script>
      </ScriptCard>

      <ScriptCard title="2. Gig Qualification">
        <Script>
          "Which apps do you drive on, how long have you been on them, and what does your account look like right now?"
        </Script>
        <Field label="Gig Apps">
          <div className="flex flex-wrap gap-1.5">
            {GIG_APPS.map((a) => {
              const on = (s.gig_apps ?? []).includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleApp(a)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs capitalize ${
                    on ? "border-real-red bg-red-50 text-red-800" : "border-border bg-white hover:bg-soft"
                  }`}
                >
                  {on && <CheckCircle2 className="h-3 w-3" />} {a}
                </button>
              );
            })}
          </div>
        </Field>
        <Row cols={2}>
          <Field label="Gig Account Status">
            <SelectInput
              value={s.gig_account_status ?? ""}
              onChange={(v) => up("gig_account_status" as any, (v || null) as any)}
              options={[
                { v: "active", l: "Active" },
                { v: "pending", l: "Pending" },
                { v: "deactivated", l: "Deactivated" },
              ]}
            />
          </Field>
          <Field label="Months On Platform">
            <NumInput value={s.months_on_platform} onChange={(v) => up("months_on_platform" as any, v as any)} />
          </Field>
          <Field label="Trip Count">
            <NumInput value={s.trip_count} onChange={(v) => up("trip_count" as any, v as any)} />
          </Field>
          <Field label="Driver Rating">
            <NumInput
              value={s.driver_rating as any}
              step="0.01"
              onChange={(v) => up("driver_rating" as any, v as any)}
            />
          </Field>
        </Row>
        <Field label="Drive Type">
          <Toggle
            options={[
              { v: "full_time", l: "Full Time" },
              { v: "part_time", l: "Part Time" },
            ]}
            value={s.drive_type ?? null}
            onChange={(v) => up("drive_type" as any, v as any)}
          />
        </Field>
      </ScriptCard>

      <ScriptCard title="3. Vehicle Need And Timing">
        <Script>
          "Do you have a car right now, or is this replacing one? When do you need to be behind the wheel? Just to
          confirm — the rate is $350 a week, weekly in advance, no deposit, on a card in your own name. That work?"
        </Script>
        <Row cols={2}>
          <Field label="Has Current Vehicle">
            <BoolToggle value={s.has_current_vehicle} onChange={(v) => up("has_current_vehicle" as any, v as any)} />
          </Field>
          <Field label="Needed By Date">
            <input
              type="date"
              value={s.needed_by_date ?? ""}
              onChange={(e) => up("needed_by_date" as any, (e.target.value || null) as any)}
              className="h-8 w-full rounded-md border border-border bg-white px-2 text-sm"
            />
          </Field>
          <Field label="Confirmed $350/Week, No Deposit, Card On File">
            <BoolToggle value={s.rate_confirmed} onChange={(v) => up("rate_confirmed" as any, v as any)} />
          </Field>
          <Field label="Card In Own Name">
            <BoolToggle value={s.card_in_own_name} onChange={(v) => up("card_in_own_name" as any, v as any)} />
          </Field>
        </Row>
      </ScriptCard>

      <ScriptCard title="4. License Verification">
        <Script>"What state issued your license, how old are you, and how long have you been licensed?"</Script>
        <Row cols={2}>
          <Field label="License State">
            <input
              value={s.license_state ?? ""}
              maxLength={2}
              onChange={(e) => up("license_state" as any, (e.target.value.toUpperCase() || null) as any)}
              className="h-8 w-full rounded-md border border-border bg-white px-2 text-sm uppercase"
            />
          </Field>
          <Field label="License Active">
            <BoolToggle value={s.license_active} onChange={(v) => up("license_active" as any, v as any)} />
          </Field>
          <Field label="Driver Age">
            <NumInput value={s.driver_age} onChange={(v) => up("driver_age" as any, v as any)} />
          </Field>
          <Field label="Years Licensed">
            <NumInput value={s.license_years} onChange={(v) => up("license_years" as any, v as any)} />
          </Field>
        </Row>
      </ScriptCard>

      <ScriptCard title="5. Insurance">
        <Script>
          "Do you have your own personal auto insurance policy right now? I'll need the carrier, policy number, and
          their phone so we can verify."
        </Script>
        <Field label="Has Personal Insurance">
          <BoolToggle value={s.has_personal_insurance} onChange={(v) => up("has_personal_insurance" as any, v as any)} />
        </Field>
        {insuranceProvided && (
          <Row cols={2}>
            <Field label="Insurance Carrier">
              <input
                value={s.insurance_carrier ?? ""}
                onChange={(e) => up("insurance_carrier" as any, (e.target.value || null) as any)}
                className="h-8 w-full rounded-md border border-border bg-white px-2 text-sm"
              />
            </Field>
            <Field label="Policy Number">
              <input
                value={s.insurance_policy_number ?? ""}
                onChange={(e) => up("insurance_policy_number" as any, (e.target.value || null) as any)}
                className="h-8 w-full rounded-md border border-border bg-white px-2 text-sm"
              />
            </Field>
            <Field label="Carrier Phone">
              <input
                value={s.insurance_carrier_phone ?? ""}
                onChange={(e) => up("insurance_carrier_phone" as any, (e.target.value || null) as any)}
                className="h-8 w-full rounded-md border border-border bg-white px-2 text-sm"
              />
            </Field>
            <Field label="Policy Active">
              <BoolToggle value={s.policy_active} onChange={(v) => up("policy_active" as any, v as any)} />
            </Field>
            <Field label="Rideshare Endorsement">
              <BoolToggle
                value={s.rideshare_endorsement}
                onChange={(v) => up("rideshare_endorsement" as any, v as any)}
              />
            </Field>
            <Field label="Insured Name Matches License">
              <BoolToggle
                value={s.insurance_name_matches_license}
                onChange={(v) => up("insurance_name_matches_license" as any, v as any)}
              />
            </Field>
          </Row>
        )}
        {s.has_personal_insurance === false && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Driver Must Obtain A Policy Before Vehicle Release.
          </div>
        )}
      </ScriptCard>

      <ScriptCard title="6. Driving History">
        <Script>
          "In the last three years, any accidents at fault? Any DUIs — ever? Any major violations like reckless or
          suspension? How many points on your license right now? And can we pull your MVR?"
        </Script>
        <Row cols={2}>
          <Field label="Accidents Last 3 Yr">
            <NumInput value={s.accidents_last_3yr} onChange={(v) => up("accidents_last_3yr" as any, v as any)} />
          </Field>
          <Field label="Has DUI">
            <BoolToggle value={s.has_dui} onChange={(v) => up("has_dui" as any, v as any)} />
          </Field>
          <Field label="Major Violations">
            <BoolToggle value={s.major_violations} onChange={(v) => up("major_violations" as any, v as any)} />
          </Field>
          <Field label="License Points">
            <NumInput value={s.license_points} onChange={(v) => up("license_points" as any, v as any)} />
          </Field>
          <Field label="MVR Authorized">
            <BoolToggle value={s.mvr_authorized} onChange={(v) => up("mvr_authorized" as any, v as any)} />
          </Field>
        </Row>
      </ScriptCard>

      <ScriptCard title="7. Notes">
        <Script>"Anything else I should know before I lock in your reservation?"</Script>
        <Field label="Interview Notes">
          <textarea
            rows={4}
            value={s.interview_notes ?? ""}
            onChange={(e) => up("interview_notes" as any, (e.target.value || null) as any)}
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
          />
        </Field>
      </ScriptCard>

      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-xl border border-border bg-white p-4 shadow-lg">
        <div className="text-xs">
          <div className="text-muted-foreground">Preview Score</div>
          <div className="text-lg font-semibold">
            {previewScore.score}/100
            {previewScore.disqualified && (
              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
                Will Disqualify: {previewScore.reasons.join(", ")}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={completeInterview}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-real-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
          Complete Interview
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Documents card                                                      */
/* ------------------------------------------------------------------ */

const DOC_LABELS: Record<RequiredDocType, string> = {
  license_front: "License Front",
  license_back: "License Back",
  insurance_card: "Insurance Card",
  driver_profile_screenshot: "Driver Profile Screenshot",
};

export function DocumentsCard({
  leadId,
  docs,
  onChange,
}: {
  leadId: string;
  docs: LeadDocument[];
  onChange: (next: LeadDocument[]) => void;
}) {
  const requiredDocs = docs.filter((d) => REQUIRED_DOC_TYPES.includes(d.doc_type as RequiredDocType));
  const have = new Set(requiredDocs.map((d) => d.doc_type));

  return (
    <div className="rounded-xl border border-border bg-white">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <div className="text-sm font-semibold">Documents</div>
        <div className="ml-auto text-xs text-muted-foreground">
          {have.size} Of 4 Documents Received
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        {REQUIRED_DOC_TYPES.map((type) => {
          const doc = requiredDocs.find((d) => d.doc_type === type);
          return (
            <DocSlot
              key={type}
              leadId={leadId}
              docType={type}
              label={DOC_LABELS[type]}
              existing={doc ?? null}
              onUploaded={(newDoc) => onChange([newDoc, ...docs.filter((d) => d.id !== newDoc.id)])}
              onRemoved={(id) => onChange(docs.filter((d) => d.id !== id))}
            />
          );
        })}
      </div>
    </div>
  );
}

function DocSlot({
  leadId,
  docType,
  label,
  existing,
  onUploaded,
  onRemoved,
  accept,
  helper,
}: {
  leadId: string;
  docType: string;
  label: string;
  existing: LeadDocument | null;
  onUploaded: (doc: LeadDocument) => void;
  onRemoved: (id: string) => void;
  accept?: string;
  helper?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!existing?.file_url) {
      setPreview(null);
      return;
    }
    let live = true;
    supabase.storage
      .from("driver-docs")
      .createSignedUrl(existing.file_url, 3600)
      .then(({ data }) => {
        if (live && data?.signedUrl) setPreview(data.signedUrl);
      });
    return () => {
      live = false;
    };
  }, [existing?.file_url]);

  async function upload(file: File) {
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${leadId}/${docType}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("driver-docs")
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (upErr) throw upErr;
      if (existing) {
        await supabase.storage.from("driver-docs").remove([existing.file_url]);
        await supabase.from("lead_documents").delete().eq("id", existing.id);
      }
      const { data, error } = await supabase
        .from("lead_documents")
        .insert({ lead_id: leadId, doc_type: docType, file_url: path })
        .select("*")
        .single();
      if (error) throw error;
      onUploaded(data as LeadDocument);
      toast.success(`${label} Uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirm(`Remove ${label}?`)) return;
    setBusy(true);
    try {
      await supabase.storage.from("driver-docs").remove([existing.file_url]);
      const { error } = await supabase.from("lead_documents").delete().eq("id", existing.id);
      if (error) throw error;
      onRemoved(existing.id);
      toast.success(`${label} Removed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const isImage = existing && !existing.file_url.toLowerCase().endsWith(".pdf") && !isAudioVideo(existing.file_url);

  return (
    <div className="rounded-lg border border-border bg-soft/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        {existing ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <CircleDashed className="h-4 w-4 text-muted-foreground" />
        )}
        <div className="text-xs font-semibold">{label}</div>
        {existing && (
          <button
            type="button"
            onClick={remove}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-white hover:text-red-700"
            title="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {existing ? (
        <a
          href={preview ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-md border border-border bg-white"
        >
          {isImage && preview ? (
            <img src={preview} alt={label} className="h-28 w-full object-cover" />
          ) : (
            <div className="flex h-28 w-full items-center justify-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-4 w-4" /> {preview ? "Open File" : "Loading…"}
            </div>
          )}
        </a>
      ) : (
        <label className="flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-white text-xs text-muted-foreground hover:bg-soft">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span>{busy ? "Uploading…" : "Upload"}</span>
          <input
            ref={inputRef}
            type="file"
            accept={accept ?? "image/*,application/pdf"}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </label>
      )}
      {helper && <div className="mt-1.5 text-[10px] text-muted-foreground">{helper}</div>}
    </div>
  );
}

function isAudioVideo(path: string): boolean {
  return /\.(mp3|wav|m4a|ogg|mp4|mov|webm)$/i.test(path);
}

/* ------------------------------------------------------------------ */
/* Insurance Verification card                                         */
/* ------------------------------------------------------------------ */

const VERIFICATION_SCRIPT = `Hi, I'm calling from REAL RENTALS, a rental car agency in Tampa, Florida. I have your insured, [Name], policy number [X], looking to rent a vehicle starting [date]. Please confirm: policy is active; collision and physical damage coverage extends to a rental vehicle in the insured's care and custody; theft and vandalism are covered; the policy includes Rental Expense Coverage or Loss Of Use; and whether commercial or rideshare use is excluded or endorsed.`;

export function InsuranceVerificationCard({
  leadId,
  screening,
  docs,
  onScreening,
  onDocs,
}: {
  leadId: string;
  screening: DriverScreening | null;
  docs: LeadDocument[];
  onScreening: (next: DriverScreening) => void;
  onDocs: (next: LeadDocument[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const recording = docs.find((d) => d.doc_type === "verification_recording");

  async function save(patch: Partial<DriverScreening>) {
    setSaving(true);
    try {
      const merged: Partial<DriverScreening> = {
        lead_id: leadId,
        ...(screening ?? {}),
        ...patch,
      };
      const { data, error } = await supabase
        .from("driver_screenings")
        .upsert(merged as any, { onConflict: "lead_id" })
        .select("*")
        .single();
      if (error) throw error;
      onScreening(data as DriverScreening);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function toggleVerified(v: boolean) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await save({
      insurance_verified: v,
      insurance_verified_at: v ? new Date().toISOString() : null,
      insurance_verified_by: v ? (user?.email ?? user?.id ?? "back-office") : null,
    });
  }

  return (
    <div className="rounded-xl border border-border bg-white">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <PhoneCall className="h-4 w-4 text-muted-foreground" />
        <div className="text-sm font-semibold">Insurance Verification Call</div>
        {screening?.insurance_verified && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
            <CheckCircle2 className="h-3 w-3" /> Verified
          </span>
        )}
      </div>
      <div className="space-y-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Call Script
        </button>
        {expanded && (
          <div className="rounded-md border border-border bg-soft/50 p-3 text-sm italic leading-relaxed text-muted-foreground">
            {VERIFICATION_SCRIPT}
          </div>
        )}
        <Row cols={2}>
          <Field label="Insurance Verified">
            <BoolToggle value={screening?.insurance_verified ?? null} onChange={toggleVerified} />
          </Field>
          <Field label="Verified By">
            <div className="rounded-md bg-soft px-2 py-1.5 text-sm">{screening?.insurance_verified_by ?? "—"}</div>
          </Field>
          <Field label="Verified At">
            <div className="rounded-md bg-soft px-2 py-1.5 text-sm">
              {screening?.insurance_verified_at ? new Date(screening.insurance_verified_at).toLocaleString() : "—"}
            </div>
          </Field>
        </Row>
        <div>
          <DocSlot
            leadId={leadId}
            docType="verification_recording"
            label="Call Recording"
            existing={recording ?? null}
            accept="audio/*,video/*"
            helper="Label file: DriverName_Date_Vehicle"
            onUploaded={(d) => onDocs([d, ...docs.filter((x) => x.id !== d.id)])}
            onRemoved={(id) => onDocs(docs.filter((x) => x.id !== id))}
          />
        </div>
        {saving && (
          <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small UI primitives                                                 */
/* ------------------------------------------------------------------ */

function ScriptCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-white">
      <div className="border-b border-border px-4 py-2.5 text-sm font-semibold">{title}</div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}
function Script({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-border bg-soft/40 px-3 py-2 text-sm italic leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
function Row({ cols, children }: { cols: 2 | 3; children: React.ReactNode }) {
  return <div className={`grid grid-cols-1 gap-3 ${cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>{children}</div>;
}
function NumInput({
  value,
  onChange,
  step,
}: {
  value: number | string | null | undefined;
  onChange: (v: number | null) => void;
  step?: string;
}) {
  return (
    <input
      type="number"
      step={step}
      value={value == null || value === ("" as any) ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="h-8 w-full rounded-md border border-border bg-white px-2 text-sm"
    />
  );
}
function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v)}>
      <SelectTrigger className="h-8 bg-white text-sm">
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.v} value={o.v}>
            {o.l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Toggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: { v: T; l: string }[];
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 text-xs font-medium ${
            value === o.v ? "bg-black text-white" : "bg-white text-foreground hover:bg-soft"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}
function BoolToggle({
  value,
  onChange,
}: {
  value: boolean | null | undefined;
  onChange: (v: boolean) => void;
}) {
  return (
    <Toggle<"yes" | "no">
      value={value == null ? null : value ? "yes" : "no"}
      onChange={(v) => onChange(v === "yes")}
      options={[
        { v: "yes", l: "Yes" },
        { v: "no", l: "No" },
      ]}
    />
  );
}

// Keep unused import references from tree-shaking accidentally breaking the tsc
// (no-op re-export to satisfy potential future imports)
export { SCREENING_STATUSES };