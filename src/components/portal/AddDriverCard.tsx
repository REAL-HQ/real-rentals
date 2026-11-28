import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Field,
  FormGrid,
  ModalBody,
  ModalButton,
  ModalFooter,
  ModalHeader,
  ModalShell,
  inputCls,
} from "@/components/admin/modal";
import {
  createAddDriverUploadUrl,
  getMyAddDriverState,
  payAddDriver,
  submitAddDriver,
} from "@/lib/add-driver-requests.functions";
import {
  ADD_DRIVER_APPLY_LABEL,
  ADD_DRIVER_BUTTON,
  ADD_DRIVER_CARD_INTRO,
  ADD_DRIVER_CARD_TITLE,
  ADD_DRIVER_CONSENT_LABEL,
  ADD_DRIVER_DIFFERENT_ADDRESS,
  ADD_DRIVER_INFO_POINTS,
  ADD_DRIVER_MAX_BYTES,
  ADD_DRIVER_PAY_LABEL,
  ADD_DRIVER_SENT,
  ADD_DRIVER_TITLE,
  APPLY_OWN_CAR_URL,
  addDriverFormError,
  compareHouseholdAddress,
  emptyAddDriverForm,
  formAddress,
  type AddDriverForm,
  type RenterAddDriverRequest,
} from "@/lib/add-driver-requests";
import type { AddressParts } from "@/lib/driver-addresses";
import { fmtDate } from "@/lib/date-format";

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const QUERY_KEY = ["portal-add-driver"];

/**
 * Driver Portal → Documents: Additional Drivers card with the Add Driver
 * button. Draws nothing while Automations → Add Driver (Portal) is Off and
 * the renter has no requests. Preview mode is read only.
 */
export function AddDriverCard({ previewDriverId }: { previewDriverId?: string | null }) {
  const load = useServerFn(getMyAddDriverState);
  const pay = useServerFn(payAddDriver);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: [...QUERY_KEY, previewDriverId ?? null],
    queryFn: () => load({ data: previewDriverId ? { previewDriverId } : {} }),
  });
  const [open, setOpen] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flag = new URLSearchParams(window.location.search).get("add_driver");
    if (flag === "paid") toast.success("Payment received. We'll start the insurance step.");
    if (flag === "canceled") toast("Payment not finished. You can pay any time from Documents.");
  }, []);

  if (!data) return null;
  if (!data.enabled && data.requests.length === 0) return null;

  async function startPay(id: string) {
    setPaying(id);
    try {
      const res = await pay({ data: { id } });
      if (res.status === "checkout") window.location.assign(res.url);
      else {
        toast.success(
          res.status === "processing"
            ? "Your payment is processing."
            : "This request is already paid.",
        );
        void qc.invalidateQueries({ queryKey: QUERY_KEY });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the payment.");
    } finally {
      setPaying(null);
    }
  }

  return (
    <section
      className="rounded-2xl border border-border bg-white p-5"
      data-testid="add-driver-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{ADD_DRIVER_CARD_TITLE}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{ADD_DRIVER_CARD_INTRO}</p>
        </div>
        {data.canRequest ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-real-red px-4 text-sm font-medium text-white"
          >
            <UserPlus className="h-4 w-4" /> {ADD_DRIVER_BUTTON}
          </button>
        ) : null}
      </div>
      {data.enabled && data.blocked ? (
        <p className="mt-3 text-sm text-muted-foreground">{data.blocked}</p>
      ) : null}
      {data.requests.length ? (
        <ul className="mt-4 divide-y divide-border">
          {data.requests.map((r: RenterAddDriverRequest) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {r.fullName}
                  {r.relationship ? ` · ${r.relationship}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.statusLine} Sent {fmtDate(r.createdAt)}.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-border bg-[#F4F4F6] px-2 py-0.5 text-[11px] font-medium">
                  {r.statusLabel}
                </span>
                {r.insuranceCardUrl ? (
                  <a
                    href={r.insuranceCardUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-real-red hover:underline"
                  >
                    <FileText className="h-3.5 w-3.5" /> Insurance Card
                  </a>
                ) : null}
                {r.canPay && data.enabled && !previewDriverId ? (
                  <button
                    type="button"
                    disabled={paying === r.id}
                    onClick={() => void startPay(r.id)}
                    className="inline-flex min-h-9 items-center rounded-lg bg-real-red px-3 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {ADD_DRIVER_PAY_LABEL}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <AddDriverModal
          mainAddress={data.mainAddress}
          onClose={() => setOpen(false)}
          onSent={(id) => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: QUERY_KEY });
            toast.success(ADD_DRIVER_SENT);
            void startPay(id);
          }}
        />
      ) : null}
    </section>
  );
}

export function AddDriverInfo() {
  return (
    <ul
      className="space-y-2 rounded-xl border border-border bg-[#FAFAFB] p-4"
      data-testid="add-driver-info"
    >
      {ADD_DRIVER_INFO_POINTS.map((p) => (
        <li key={p.title} className="text-sm">
          <span className="font-semibold">{p.title}:</span>{" "}
          <span className="text-muted-foreground">{p.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function DifferentAddressNotice() {
  return (
    <div
      role="alert"
      className="rounded-xl border border-real-red/30 bg-real-red/5 p-4 text-sm"
      data-testid="add-driver-different-address"
    >
      <p>{ADD_DRIVER_DIFFERENT_ADDRESS}</p>
      <a
        href={APPLY_OWN_CAR_URL}
        className="mt-2 inline-flex font-medium text-real-red hover:underline"
      >
        {ADD_DRIVER_APPLY_LABEL}
      </a>
    </div>
  );
}

function AddDriverModal({
  mainAddress,
  onClose,
  onSent,
}: {
  mainAddress: AddressParts | null;
  onClose: () => void;
  onSent: (id: string) => void;
}) {
  const startUpload = useServerFn(createAddDriverUploadUrl);
  const submit = useServerFn(submitAddDriver);
  const [form, setForm] = useState<AddDriverForm>(() => emptyAddDriverForm(mainAddress));
  const [sending, setSending] = useState(false);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof AddDriverForm>(k: K, v: AddDriverForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const address = compareHouseholdAddress(mainAddress, formAddress(form));
  const different = address === "different";
  const problem = useMemo(() => addDriverFormError(form, todayEt()), [form]);

  async function upload(kind: "license_front" | "license_back", file: File) {
    const signed = await startUpload({
      data: {
        kind,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      },
    });
    const { error } = await supabase.storage
      .from(signed.bucket)
      .uploadToSignedUrl(signed.path, signed.token, file);
    if (error) throw new Error(error.message);
    set(kind === "license_front" ? "licenseFrontPath" : "licenseBackPath", signed.path);
  }

  async function send() {
    setTried(true);
    if (problem || different) return;
    setSending(true);
    try {
      const row = await submit({ data: form });
      onSent(row.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your request.");
    } finally {
      setSending(false);
    }
  }

  return (
    <ModalShell onClose={onClose} size="lg" label={ADD_DRIVER_TITLE}>
      <ModalHeader
        title={ADD_DRIVER_TITLE}
        subtitle="Tell us about the driver you want to add."
        onClose={onClose}
      />
      <ModalBody>
        <AddDriverInfo />
        <FormGrid cols={2}>
          <Field label="Full Name" required>
            <input
              className={inputCls}
              value={form.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Date Of Birth" required>
            <input
              type="date"
              className={inputCls}
              value={form.dob}
              onChange={(e) => set("dob", e.target.value)}
            />
          </Field>
          <Field label="Phone" required>
            <PhoneInput
              mode="us"
              className={inputCls}
              value={form.phone}
              onValueChange={(v) => set("phone", v)}
              autoComplete="off"
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              className={inputCls}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Relationship" required>
            <input
              className={inputCls}
              value={form.relationship}
              onChange={(e) => set("relationship", e.target.value)}
              placeholder="Spouse, Partner, Parent"
            />
          </Field>
          <Field label="Years Licensed">
            <input
              inputMode="numeric"
              className={inputCls}
              value={form.yearsLicensed}
              onChange={(e) => set("yearsLicensed", e.target.value.replace(/\D/g, "").slice(0, 2))}
            />
          </Field>
        </FormGrid>
        <div className="space-y-3">
          <p className="text-[13px] font-semibold">Home Address</p>
          <p className="text-xs text-muted-foreground">
            We filled in your address. It must match for us to add this driver.
          </p>
          <FormGrid cols={2}>
            <Field label="Street" required>
              <input
                className={inputCls}
                value={form.addressLine1}
                onChange={(e) => set("addressLine1", e.target.value)}
              />
            </Field>
            <Field label="Apt Or Unit">
              <input
                className={inputCls}
                value={form.addressLine2}
                onChange={(e) => set("addressLine2", e.target.value)}
              />
            </Field>
            <Field label="City" required>
              <input
                className={inputCls}
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="State" required>
                <input
                  className={inputCls}
                  value={form.state}
                  onChange={(e) => set("state", e.target.value)}
                  maxLength={20}
                />
              </Field>
              <Field label="ZIP" required>
                <input
                  inputMode="numeric"
                  className={inputCls}
                  value={form.zip}
                  onChange={(e) => set("zip", e.target.value)}
                  maxLength={10}
                />
              </Field>
            </div>
          </FormGrid>
          {different ? <DifferentAddressNotice /> : null}
        </div>
        <div className="space-y-3">
          <p className="text-[13px] font-semibold">Driver's License</p>
          <FormGrid cols={3}>
            <Field label="License Number" required>
              <input
                className={inputCls}
                value={form.licenseNumber}
                onChange={(e) => set("licenseNumber", e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="License State" required>
              <input
                className={inputCls}
                value={form.licenseState}
                onChange={(e) => set("licenseState", e.target.value)}
                maxLength={20}
              />
            </Field>
            <Field label="Expiration" required>
              <input
                type="date"
                className={inputCls}
                value={form.licenseExpiration}
                onChange={(e) => set("licenseExpiration", e.target.value)}
              />
            </Field>
          </FormGrid>
          <FormGrid cols={2}>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">
                License Front <span className="text-brand">*</span>
              </p>
              <FileUploader
                variant="zone"
                accept="image/*,application/pdf"
                maxBytes={ADD_DRIVER_MAX_BYTES}
                camera
                title="License Front"
                context="Add Driver · License Front"
                upload={(file) => upload("license_front", file)}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">
                License Back <span className="text-brand">*</span>
              </p>
              <FileUploader
                variant="zone"
                accept="image/*,application/pdf"
                maxBytes={ADD_DRIVER_MAX_BYTES}
                camera
                title="License Back"
                context="Add Driver · License Back"
                upload={(file) => upload("license_back", file)}
              />
            </div>
          </FormGrid>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.consent}
            onChange={(e) => set("consent", e.target.checked)}
          />
          <span>{ADD_DRIVER_CONSENT_LABEL}</span>
        </label>
        {tried && problem && !different ? (
          <p role="alert" className="text-sm text-real-red">
            {problem}
          </p>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" disabled={sending || different} onClick={() => void send()}>
          Send Request
        </ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}
