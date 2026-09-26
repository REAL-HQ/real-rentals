import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Upload,
  Trash2,
  Loader2,
  AlertTriangle,
  Check,
  RotateCcw,
  FileText,
  History,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  DOC_CATEGORIES,
  adminListDriverDocuments,
  createDocumentUploadUrl,
  confirmDocumentUpload,
  updateDocumentMeta,
  deleteDocument,
  setDocumentReview,
  type VaultDocument,
  type DocCategory,
} from "@/lib/documents.functions";
import { DocumentViewer, type ViewerDoc } from "./DocumentViewer";
import { MicroLabel } from "./ui";

// Everything an applicant sent us, in one place, grouped the way somebody
// looking at it actually thinks.
//
// This replaces three stacked surfaces that each showed part of the answer:
// the vault (a text list with no thumbnail), a staff-upload card backed by a
// different table, and two one-off cards that read the raw application
// columns. Same underlying vault, one view over it — no second document
// system, no second storage architecture.
//
// The status a document carries is deliberately narrow. Uploaded means it
// arrived. Verified means a person looked at it. Those are different facts and
// the readiness model depends on them staying apart.

const MAX_MB = 15;

/** Categories in the order a reviewer works through them. */
const ORDER: DocCategory[] = [
  "license_front",
  "license_back",
  "insurance",
  "gig_profile",
  "agreement",
  "other",
];

type Status = "verified" | "rejected" | "expired" | "uploaded" | "missing";

function statusOf(d: VaultDocument | undefined): Status {
  if (!d) return "missing";
  if (d.review_status === "rejected") return "rejected";
  if (d.expires_at && new Date(d.expires_at).getTime() < Date.now()) return "expired";
  if (d.review_status === "verified") return "verified";
  return "uploaded";
}

const STATUS_STYLE: Record<Status, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { label: "Needs Replacement", cls: "bg-red-50 text-red-700 border-red-200" },
  expired: { label: "Expired", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  uploaded: { label: "Uploaded", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  // Not red. A document nobody has sent yet is an outstanding task, not a fault.
  missing: { label: "Not Received", cls: "bg-[#F4F4F6] text-[#55555E] border-[#EDEDF0]" },
};

function fmtSize(n: number | null) {
  if (!n) return null;
  return n > 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isImageDoc(d: VaultDocument): boolean {
  if ((d.mime_type ?? "").startsWith("image/")) return true;
  if (d.mime_type) return false;
  return !/\.(pdf|mp3|wav|m4a|ogg|mp4|mov|webm|zip|docx?)$/i.test(d.file_name ?? "");
}

/** The four categories the screening pipeline treats as required. */
export const REQUIRED_VAULT_CATEGORIES: DocCategory[] = [
  "license_front",
  "license_back",
  "insurance",
  "gig_profile",
];

export function ApplicantDocuments({
  applicationId,
  onRequiredCountChange,
  onDocumentsChange,
}: {
  applicationId: string;
  /**
   * How many required categories are on file. The screening pipeline gates
   * "Docs Pending → Insurance Verified" on this, and it has to come from the
   * same vault the tab renders or the two will disagree.
   */
  onRequiredCountChange?: (n: number) => void;
  /** The current rows, so readiness reads the same vault the tab shows. */
  onDocumentsChange?: (docs: VaultDocument[]) => void;
}) {
  const list = useServerFn(adminListDriverDocuments);
  const startUpload = useServerFn(createDocumentUploadUrl);
  const confirmUpload = useServerFn(confirmDocumentUpload);
  const patchMeta = useServerFn(updateDocumentMeta);
  const removeDoc = useServerFn(deleteDocument);
  const review = useServerFn(setDocumentReview);

  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewerDoc | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const pending = useRef<DocCategory | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setDocs(await list({ data: { applicationId } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, [applicationId, list]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // One pass, not one find() per category.
  const { current, history } = useMemo(() => {
    const cur = new Map<string, VaultDocument>();
    const past: VaultDocument[] = [];
    for (const d of docs) {
      if (!d.is_current) {
        past.push(d);
        continue;
      }
      // Several files can share a category (trip screenshots). Keep the newest
      // as the face of the group and treat the rest as extras.
      const seen = cur.get(d.category);
      if (!seen || d.created_at > seen.created_at) cur.set(d.category, d);
    }
    return { current: cur, history: past };
  }, [docs]);

  useEffect(() => {
    onRequiredCountChange?.(REQUIRED_VAULT_CATEGORIES.filter((c) => current.has(c)).length);
    onDocumentsChange?.(docs);
    // The callbacks are parent-owned; depending on them would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, docs]);

  const extras = useMemo(
    () => docs.filter((d) => d.is_current && current.get(d.category)?.id !== d.id),
    [docs, current],
  );

  function pick(category: DocCategory) {
    pending.current = category;
    fileInput.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const category = pending.current;
    pending.current = null;
    if (!file || !category) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`Files must be under ${MAX_MB} MB`);
      return;
    }
    setBusy(category);
    try {
      const signed = await startUpload({
        data: {
          applicationId,
          category,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
        },
      });
      const { error } = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (error) throw new Error(error.message);
      await confirmUpload({
        data: {
          applicationId: signed.applicationId!,
          category,
          path: signed.path,
          fileName: file.name,
          mimeType: file.type || null,
          sizeBytes: file.size,
        },
      });
      toast.success("Document uploaded");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function decide(d: VaultDocument, status: "verified" | "rejected" | "uploaded") {
    let note: string | null = null;
    if (status === "rejected") {
      note = window.prompt("What is wrong with it? The applicant will be told.")?.trim() || null;
      if (note === null) return;
    }
    setBusy(d.id);
    try {
      await review({ data: { documentId: d.id, status, note } });
      toast.success(
        status === "verified"
          ? "Marked verified"
          : status === "rejected"
            ? "Marked as needing a replacement"
            : "Review cleared",
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  async function setExpiry(d: VaultDocument, value: string) {
    try {
      await patchMeta({ data: { documentId: d.id, expiresAt: value || null } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function drop(d: VaultDocument) {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    setBusy(d.id);
    try {
      await removeDoc({ data: { documentId: d.id } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(null);
    }
  }

  function open(d: VaultDocument, title: string) {
    const st = statusOf(d);
    setViewing({
      url: d.url,
      fileName: d.file_name,
      mimeType: d.mime_type,
      title,
      meta: [
        { label: "Status", value: STATUS_STYLE[st].label },
        { label: "Uploaded", value: fmtDate(d.created_at) ?? "—" },
        ...(d.expires_at ? [{ label: "Expires", value: d.expires_at }] : []),
        ...(fmtSize(d.size_bytes) ? [{ label: "Size", value: fmtSize(d.size_bytes)! }] : []),
        ...(d.uploaded_by_role ? [{ label: "From", value: d.uploaded_by_role }] : []),
      ],
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-5 py-8 text-[13px] text-[#9A9AA3]">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
      </div>
    );
  }

  const received = ORDER.filter((c) => current.has(c)).length;

  return (
    <div className="space-y-4">
      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={onFile}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <MicroLabel>
          {received} of {ORDER.length} document types received
        </MicroLabel>
        {history.length > 0 && (
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#55555E] hover:text-[#111114]"
          >
            <History className="w-3.5 h-3.5" />
            {showHistory ? "Hide" : "Show"} replaced versions ({history.length})
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {ORDER.map((key) => {
          const meta = DOC_CATEGORIES.find((c) => c.key === key)!;
          const d = current.get(key);
          const st = statusOf(d);
          const style = STATUS_STYLE[st];
          const working = busy === key || (d && busy === d.id);
          return (
            <div
              key={key}
              className="rounded-xl border border-[#EDEDF0] bg-white overflow-hidden flex flex-col"
            >
              <button
                type="button"
                disabled={!d}
                onClick={() => d && open(d, meta.label)}
                className="relative block w-full aspect-[16/10] bg-[#FAFAFB] border-b border-[#EDEDF0] disabled:cursor-default group"
              >
                {d && d.url && isImageDoc(d) ? (
                  <img
                    src={d.url}
                    alt={meta.label}
                    className="absolute inset-0 w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                  />
                ) : d ? (
                  <span className="absolute inset-0 grid place-items-center text-[#9A9AA3]">
                    <FileText className="w-7 h-7" />
                  </span>
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-[11px] text-[#C4C4CB]">
                    Not received
                  </span>
                )}
                {d && !d.url && (
                  <span className="absolute inset-x-0 bottom-0 bg-red-600/90 text-white text-[10px] py-1">
                    File missing from storage
                  </span>
                )}
              </button>

              <div className="p-3 flex-1 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#111114] leading-tight">
                    {meta.label}
                  </span>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${style.cls}`}
                  >
                    {style.label}
                  </span>
                </div>

                {d && (
                  <div className="text-[11px] text-[#9A9AA3] space-y-0.5">
                    <div className="truncate">{d.file_name ?? "File"}</div>
                    <div className="flex flex-wrap gap-x-2">
                      <span>{fmtDate(d.created_at)}</span>
                      {fmtSize(d.size_bytes) && <span>· {fmtSize(d.size_bytes)}</span>}
                    </div>
                    {d.review_note && <div className="text-[#D03020] pt-0.5">{d.review_note}</div>}
                  </div>
                )}

                {d && meta.expiring && (
                  <label className="flex items-center gap-1.5 text-[10px] text-[#9A9AA3]">
                    <Clock className="w-3 h-3 shrink-0" />
                    Expires
                    <input
                      type="date"
                      value={d.expires_at ?? ""}
                      onChange={(e) => void setExpiry(d, e.target.value)}
                      className="flex-1 min-w-0 rounded border border-[#EDEDF0] px-1.5 py-0.5 text-[10px]"
                    />
                  </label>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                  {d && st !== "verified" && (
                    <button
                      onClick={() => void decide(d, "verified")}
                      disabled={!!working}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white px-2 py-1 text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <ShieldCheck className="w-3 h-3" /> Verify
                    </button>
                  )}
                  {d && st === "verified" && (
                    <button
                      onClick={() => void decide(d, "uploaded")}
                      disabled={!!working}
                      className="inline-flex items-center gap-1 rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] font-medium text-[#55555E] hover:border-[#C4C4CB] disabled:opacity-50"
                    >
                      <RotateCcw className="w-3 h-3" /> Unverify
                    </button>
                  )}
                  {d && st !== "rejected" && (
                    <button
                      onClick={() => void decide(d, "rejected")}
                      disabled={!!working}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 text-red-700 px-2 py-1 text-[11px] font-medium hover:bg-red-50 disabled:opacity-50"
                    >
                      <AlertTriangle className="w-3 h-3" /> Needs New
                    </button>
                  )}
                  <button
                    onClick={() => pick(key)}
                    disabled={!!working}
                    className="inline-flex items-center gap-1 rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] font-medium text-[#55555E] hover:border-[#C4C4CB] disabled:opacity-50"
                  >
                    {working ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Upload className="w-3 h-3" />
                    )}
                    {d ? "Replace" : "Upload"}
                  </button>
                  {d && (
                    <button
                      onClick={() => void drop(d)}
                      disabled={!!working}
                      className="ml-auto rounded-md p-1 text-[#9A9AA3] hover:text-[#D03020] disabled:opacity-50"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {extras.length > 0 && (
        <div>
          <MicroLabel className="mb-2">Additional files</MicroLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-2">
            {extras.map((d) => (
              <button
                key={d.id}
                onClick={() => open(d, d.label ?? d.file_name ?? "Document")}
                className="rounded-lg border border-[#EDEDF0] overflow-hidden bg-[#FAFAFB] aspect-square relative group"
              >
                {d.url && isImageDoc(d) ? (
                  <img
                    src={d.url}
                    alt={d.file_name ?? "Document"}
                    className="absolute inset-0 w-full h-full object-cover group-hover:opacity-90"
                  />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-[#9A9AA3]">
                    <FileText className="w-6 h-6" />
                  </span>
                )}
                {statusOf(d) === "verified" && (
                  <span className="absolute top-1 right-1 rounded-full bg-emerald-600 text-white p-0.5">
                    <Check className="w-2.5 h-2.5" strokeWidth={3} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {showHistory && history.length > 0 && (
        <div>
          <MicroLabel className="mb-2">Replaced versions</MicroLabel>
          <ul className="rounded-xl border border-[#EDEDF0] bg-white divide-y divide-[#F4F4F6]">
            {history.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                <FileText className="w-3.5 h-3.5 text-[#C4C4CB] shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[#55555E]">
                  {d.label ?? d.file_name}
                </span>
                <span className="text-[11px] text-[#9A9AA3] shrink-0">{fmtDate(d.created_at)}</span>
                <button
                  onClick={() => open(d, `${d.label ?? d.file_name} (replaced)`)}
                  className="text-[11px] font-medium text-[#55555E] hover:text-[#111114] shrink-0"
                >
                  View
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
