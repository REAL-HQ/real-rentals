import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import {
  approveAddDriver,
  createAddDriverCardUploadUrl,
  denyAddDriver,
  getAddDriverFileUrl,
  listAddDriverRequests,
  startAddDriverInsuranceStep,
} from "@/lib/add-driver-requests.functions";
import {
  ADD_DRIVER_MAX_BYTES,
  ADD_DRIVER_STATUS_LABEL,
  type AddDriverStatus,
} from "@/lib/add-driver-requests";
import { formatAddress } from "@/lib/driver-addresses";
import { fmtDate } from "@/lib/date-format";
import { rowNav } from "@/lib/row-click";
import {
  Field,
  ModalBody,
  ModalButton,
  ModalFooter,
  ModalHeader,
  ModalShell,
  inputCls,
} from "./modal";

type Row = Awaited<ReturnType<typeof listAddDriverRequests>>[number];

const btn =
  "h-8 rounded-lg border border-border bg-white px-2.5 text-[12px] font-medium text-[#111114] hover:bg-[#F4F4F6] disabled:opacity-50";
const solid =
  "h-8 rounded-lg bg-[#111114] px-2.5 text-[12px] font-semibold text-white hover:bg-[#2A2A30] disabled:opacity-50";

const TONE: Record<AddDriverStatus, string> = {
  requested: "bg-[#F4F4F6] text-[#111114]",
  paid: "bg-[#FFF4E5] text-[#8A4B00]",
  insurance_pending: "bg-[#EAF2FF] text-[#1D4ED8]",
  approved: "bg-[#E8F7EE] text-[#166534]",
  denied: "bg-[#FDECEC] text-[#B42318]",
};

export function AddDriverStatusBadge({ status }: { status: AddDriverStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[status]}`}
    >
      {ADD_DRIVER_STATUS_LABEL[status]}
    </span>
  );
}

function useRequests(filter: { applicationId?: string; open?: boolean }) {
  const load = useServerFn(listAddDriverRequests);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    load({ data: filter })
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load Add Driver requests."),
      );
  }, [load, filter.applicationId, filter.open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(refresh, [refresh]);
  return { rows, error, refresh };
}

/** Drivers → Add Driver: every request, open ones first. Rows open the renter's profile. */
export function AddDriverRequestsPanel() {
  const [view, setView] = useState<"open" | "all">("open");
  const { rows, error, refresh } = useRequests({ open: view === "open" });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#111114]">Add Driver</h2>
          <p className="text-[13px] text-[#55555E]">
            Renters asking to add a driver at the same address. Start the insurance step once paid,
            then record Approved with the insurance card, or Denied with a note.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-[#F4F4F6] p-1">
          {(["open", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${view === v ? "bg-white shadow-sm" : "text-[#55555E]"}`}
            >
              {v === "open" ? "Open" : "All"}
            </button>
          ))}
        </div>
      </div>
      <AddDriverRequestList rows={rows} error={error} onChanged={refresh} linkToProfile />
    </div>
  );
}

/** Driver profile: this renter's Add Driver requests. Hidden when there are none. */
export function AddDriverRequestsSection({ applicationId }: { applicationId: string }) {
  const { rows, error, refresh } = useRequests({ applicationId });
  // Coordinators are refused by the server; the section simply stays hidden for them.
  if (error || !rows || rows.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="add-driver-requests-section">
      <h3 className="text-[14px] font-semibold text-[#111114]">Add Driver Requests</h3>
      <AddDriverRequestList rows={rows} error={null} onChanged={refresh} />
    </section>
  );
}

function AddDriverRequestList({
  rows,
  error,
  onChanged,
  linkToProfile = false,
}: {
  rows: Row[] | null;
  error: string | null;
  onChanged: () => void;
  linkToProfile?: boolean;
}) {
  const navigate = useNavigate();
  if (error) return <p className="text-[13px] text-[#B42318]">{error}</p>;
  if (!rows) return <p className="text-[13px] text-[#55555E]">Loading…</p>;
  if (!rows.length)
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-[13px] text-[#55555E]">
        No Add Driver requests.
      </p>
    );
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-white">
      {rows.map((r) => (
        <li
          key={r.id}
          {...rowNav(
            navigate,
            linkToProfile ? { tab: "drivers", id: r.applicationId } : null,
            "space-y-2 p-3",
          )}
        >
          <RequestRow row={r} onChanged={onChanged} showRenter={linkToProfile} />
        </li>
      ))}
    </ul>
  );
}

function RequestRow({
  row,
  onChanged,
  showRenter,
}: {
  row: Row;
  onChanged: () => void;
  showRenter: boolean;
}) {
  const fileUrl = useServerFn(getAddDriverFileUrl);
  const start = useServerFn(startAddDriverInsuranceStep);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "approve" | "deny">(null);

  async function open(kind: "license_front" | "license_back" | "insurance_card") {
    try {
      const { url } = await fileUrl({ data: { id: row.id, kind } });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the file.");
    }
  }
  async function startInsurance() {
    setBusy(true);
    try {
      await start({ data: { id: row.id } });
      toast.success("Insurance step started");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update this request.");
    } finally {
      setBusy(false);
    }
  }
  const closed = row.status === "approved" || row.status === "denied";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[#111114]">
            {row.fullName}
            <span className="font-normal text-[#55555E]"> · {row.relationship}</span>
          </p>
          <p className="text-[12px] text-[#55555E]">
            {showRenter
              ? `For ${row.renterName ?? "Renter"}${row.plate ? ` · ${row.plate}` : ""} · `
              : ""}
            Sent {fmtDate(row.createdAt)}
          </p>
        </div>
        <AddDriverStatusBadge status={row.status} />
      </div>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-[12px] text-[#55555E] sm:grid-cols-2">
        <div>DOB {row.dob || "—"}</div>
        <div>
          License {row.licenseState} {row.licenseNumber} · Exp {row.licenseExpiration || "—"}
        </div>
        <div>
          {row.email} · {row.phone}
        </div>
        <div>Years Licensed {row.yearsLicensed ?? "—"}</div>
        <div className="sm:col-span-2">Address {formatAddress(row.address)}</div>
        <div>
          Payment {row.paymentStatus ? row.paymentStatus.replace(/_/g, " ") : "Not Started"}
          {row.paidAt ? ` · ${fmtDate(row.paidAt)}` : ""}
        </div>
        {row.decisionNotes ? <div className="sm:col-span-2">Notes {row.decisionNotes}</div> : null}
        {row.refundNote ? <div className="sm:col-span-2">Refund {row.refundNote}</div> : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => void open("license_front")}>
          License Front
        </button>
        <button type="button" className={btn} onClick={() => void open("license_back")}>
          License Back
        </button>
        {row.hasInsuranceCard ? (
          <button type="button" className={btn} onClick={() => void open("insurance_card")}>
            Insurance Card
          </button>
        ) : null}
        {row.status === "paid" ? (
          <button
            type="button"
            className={solid}
            disabled={busy}
            onClick={() => void startInsurance()}
          >
            Start Insurance
          </button>
        ) : null}
        {row.status === "insurance_pending" ? (
          <button type="button" className={solid} onClick={() => setDialog("approve")}>
            Approve
          </button>
        ) : null}
        {!closed ? (
          <button type="button" className={btn} onClick={() => setDialog("deny")}>
            Deny
          </button>
        ) : null}
      </div>
      {dialog ? (
        <div data-no-row-click>
          {dialog === "approve" ? (
            <ApproveDialog
              row={row}
              onClose={() => setDialog(null)}
              onDone={() => {
                setDialog(null);
                onChanged();
              }}
            />
          ) : null}
          {dialog === "deny" ? (
            <DenyDialog
              row={row}
              onClose={() => setDialog(null)}
              onDone={() => {
                setDialog(null);
                onChanged();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function ApproveDialog({
  row,
  onClose,
  onDone,
}: {
  row: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const startUpload = useServerFn(createAddDriverCardUploadUrl);
  const approve = useServerFn(approveAddDriver);
  const [path, setPath] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    const signed = await startUpload({
      data: {
        id: row.id,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      },
    });
    const { error } = await supabase.storage
      .from(signed.bucket)
      .uploadToSignedUrl(signed.path, signed.token, file);
    if (error) throw new Error(error.message);
    setPath(signed.path);
  }
  async function save() {
    if (!path) return;
    setBusy(true);
    try {
      await approve({ data: { id: row.id, insuranceCardPath: path, notes: notes || undefined } });
      toast.success("Driver approved. The insurance card is in the renter's portal.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalShell onClose={onClose} size="md" label="Approve Driver">
      <ModalHeader
        title="Approve Driver"
        subtitle={`${row.fullName} is on the policy. Upload their insurance card to finish.`}
        onClose={onClose}
      />
      <ModalBody>
        <FileUploader
          variant="zone"
          accept="image/*,application/pdf"
          maxBytes={ADD_DRIVER_MAX_BYTES}
          title="Insurance Card"
          context={`${row.fullName} · Insurance Card`}
          upload={(file) => upload(file)}
        />
        <Field label="Notes">
          <textarea
            className={`${inputCls} h-24 py-2`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" disabled={!path || busy} onClick={() => void save()}>
          Approve
        </ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

function DenyDialog({
  row,
  onClose,
  onDone,
}: {
  row: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const deny = useServerFn(denyAddDriver);
  const [notes, setNotes] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [busy, setBusy] = useState(false);
  const paid = row.paymentStatus === "paid";
  async function save() {
    setBusy(true);
    try {
      await deny({ data: { id: row.id, notes, refundNote: refundNote || undefined } });
      toast.success("Request denied");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not deny.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalShell onClose={onClose} size="md" label="Deny Driver">
      <ModalHeader
        title="Deny Driver"
        subtitle="The renter sees Denied. They don't see your notes."
        onClose={onClose}
      />
      <ModalBody>
        <Field label="Reason" required>
          <textarea
            className={`${inputCls} h-24 py-2`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {paid ? (
          <>
            <p className="rounded-lg bg-[#FFF4E5] p-3 text-[13px] text-[#8A4B00]">
              The $100 was paid. Denying does not refund it. Refund it in Payments if needed, and
              note it here.
            </p>
            <Field label="Refund Note">
              <input
                className={inputCls}
                value={refundNote}
                onChange={(e) => setRefundNote(e.target.value)}
              />
            </Field>
          </>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" disabled={!notes.trim() || busy} onClick={() => void save()}>
          Deny
        </ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}
