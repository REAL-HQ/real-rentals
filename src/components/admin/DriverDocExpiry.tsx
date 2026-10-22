import {
  DRIVER_DOC_EXPIRY_ENABLED,
  DRIVER_DOC_EXPIRY_SEPARATE_TNC,
  type DriverDocExpiryResult,
} from "@/lib/driver-doc-expiry";

const LABELS: Record<string, string> = {
  expired: "Expired",
  expiring: "Expires In 30 Days",
  ok: "OK",
  unknown: "Unknown",
  pending: "…",
  failed: "—",
  unread: "Not In This Read",
};

const TONES: Record<string, string> = {
  expired: "bg-red-100 text-red-800",
  expiring: "bg-amber-100 text-amber-800",
  ok: "bg-emerald-100 text-emerald-800",
  unknown: "bg-[#F2F2F4] text-[#55555E]",
  pending: "bg-[#F2F2F4] text-[#55555E]",
  failed: "bg-[#F2F2F4] text-[#55555E]",
  unread: "bg-[#F2F2F4] text-[#55555E]",
};

export function DriverDocExpiryHeader() {
  if (DRIVER_DOC_EXPIRY_ENABLED !== true) return null;
  return <th className="text-left font-medium px-3 py-2.5 border-b border-border">Documents</th>;
}

export function DriverDocExpiryCell({
  status,
  separateLabel = null,
}: {
  status: string;
  separateLabel?: string | null;
}) {
  if (DRIVER_DOC_EXPIRY_ENABLED !== true) return null;
  const label =
    DRIVER_DOC_EXPIRY_SEPARATE_TNC === true && separateLabel
      ? separateLabel
      : (LABELS[status] ?? LABELS.unknown);
  const tone = TONES[status] ?? TONES.unknown;
  return (
    <span
      data-documents-status={status}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${tone}`}
    >
      {label}
    </span>
  );
}

export function DriverDocExpiryFilter({
  canView,
  value,
  onChange,
  counts,
  tncTracked = false,
}: {
  canView: boolean;
  value: string;
  onChange: (value: string) => void;
  counts: { expired: number; expiring: number; ok: number; unknown: number };
  /** The OK filter stays hidden until a TNC date is actually tracked. */
  tncTracked?: boolean;
}) {
  if (DRIVER_DOC_EXPIRY_ENABLED !== true || canView !== true) return null;
  const showOk = !(DRIVER_DOC_EXPIRY_SEPARATE_TNC === true && tncTracked !== true);
  return (
    <select
      aria-label="Documents"
      data-documents-filter
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="shrink-0 rounded-md border border-border bg-white px-2 py-1.5 text-xs"
    >
      <option value="all">Documents: All</option>
      <option value="expired">Expired ({counts.expired})</option>
      <option value="expiring">Expires In 30 Days ({counts.expiring})</option>
      {showOk ? <option value="ok">OK ({counts.ok})</option> : null}
      <option value="unknown">Unknown ({counts.unknown})</option>
    </select>
  );
}

export function DriverDocExpiryNotice({
  canView,
  meta,
}: {
  canView: boolean;
  meta: Pick<DriverDocExpiryResult, "failed" | "truncated" | "cap"> | null;
}) {
  if (DRIVER_DOC_EXPIRY_ENABLED !== true || canView !== true) return null;
  return (
    <div className="mb-3 text-[12px] text-[#55555E]" data-documents-notice>
      <p>TNC Approval Date Not Tracked</p>
      {meta?.failed ? <p>Could Not Load Document Expiry</p> : null}
      {meta && !meta.failed && meta.truncated ? (
        <p>Showing The First {meta.cap} Drivers. The Rest Were Not Read.</p>
      ) : null}
    </div>
  );
}
