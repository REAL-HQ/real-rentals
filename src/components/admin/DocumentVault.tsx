import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trash2, ExternalLink, Lock, History, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import {
  DOC_CATEGORIES,
  adminListDriverDocuments,
  createDocumentUploadUrl,
  confirmDocumentUpload,
  updateDocumentMeta,
  deleteDocument,
  getMyVault,
  type VaultDocument,
  type DocCategory,
} from "@/lib/documents.functions";
import { fmtDate, fmtDateTime } from "@/lib/date-format";
import { documentExpiryTone } from "@/lib/document-expiry";
import { signedAgreementLocked } from "@/lib/signed-agreement-evidence";

const MAX_MB = 15;

const DOC_TYPE_TITLES: Record<string, string> = {
  license_front: "Driver's License (Front)",
  license_back: "Driver's License (Back)",
  insurance: "Insurance Card",
  gig_profile: "Gig Profile Screenshot",
  trip_history: "Trip History Screenshot",
  agreement: "Signed Agreement",
  other: "Other Document",
  verification_recording: "Verification Call Recording",
};

function fmtSize(n: number | null) {
  if (!n) return "";
  return n > 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function expiryTone(d: VaultDocument): "expired" | "soon" | null {
  return documentExpiryTone(d.expires_at);
}

/**
 * Shared document vault. Every upload remains visible by category, with the
 * newest file marked Latest and earlier files retained beneath it. Driver-sent
 * files are permanent records; staff cannot delete them from this vault.
 */
export function DocumentVault({
  mode,
  applicationId,
  readOnly = false,
  initialDocuments,
  externalLoading = false,
}: {
  mode: "admin" | "driver";
  applicationId?: string;
  /** Staff driver preview supplies authorized metadata and never upload controls. */
  readOnly?: boolean;
  initialDocuments?: VaultDocument[];
  externalLoading?: boolean;
}) {
  const listAdmin = useServerFn(adminListDriverDocuments);
  const listMine = useServerFn(getMyVault);
  const startUpload = useServerFn(createDocumentUploadUrl);
  const confirmUpload = useServerFn(confirmDocumentUpload);
  const patchMeta = useServerFn(updateDocumentMeta);
  const removeDoc = useServerFn(deleteDocument);

  const [fetchedDocs, setDocs] = useState<VaultDocument[]>([]);
  const [appId, setAppId] = useState<string | null>(applicationId ?? null);
  const [loading, setLoading] = useState(initialDocuments === undefined);
  const controlled = initialDocuments !== undefined;
  const docs = initialDocuments ?? fetchedDocs;
  const isLoading = controlled ? externalLoading : loading;

  async function refresh() {
    if (controlled) return;
    try {
      if (mode === "admin" && applicationId) {
        setDocs(await listAdmin({ data: { applicationId } }));
        setAppId(applicationId);
      } else {
        const res = await listMine();
        setDocs(res.documents);
        setAppId(res.applicationId);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, mode, controlled]);

  async function uploadDoc(category: DocCategory, internal: boolean, file: File) {
    if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Files must be under ${MAX_MB} MB`);
    try {
      const signed = await startUpload({
        data: {
          applicationId: appId ?? undefined,
          category,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          internal: internal || undefined,
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
          mimeType: file.type || (null as any),
          sizeBytes: file.size,
          internal,
        },
      });
      toast.success("Document uploaded");
      await refresh();
    } catch (err: any) {
      throw new Error(err?.message || "Upload failed");
    }
  }

  const current = docs.filter((d) => d.is_current);
  const categories =
    mode === "admin"
      ? DOC_CATEGORIES
      : DOC_CATEGORIES.filter((c) => c.key !== "agreement" && c.key !== "verification_recording");

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[#55555E] py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-[#EDEDF0] border border-[#EDEDF0] rounded-xl overflow-hidden bg-white">
        {categories.map((cat) => {
          const versions = docs
            .filter((d) => d.category === cat.key)
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
          const doc = versions[0] ?? null;
          const previous = versions.slice(1);
          const tone = doc ? expiryTone(doc) : null;
          const title = DOC_TYPE_TITLES[cat.key] ?? cat.label;
          return (
            <li key={cat.key} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-[#111114]">{title}</span>
                    {doc ? (
                      <span className="inline-flex items-center rounded-full border border-[#BFE3CC] bg-[#EAF6EE] px-2 py-0.5 text-[10.5px] font-semibold text-[#1F8A4C]">
                        Latest
                      </span>
                    ) : null}
                    {doc && !doc.visibility.includes("driver") ? (
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#77777F] bg-[#F4F4F6] border border-[#E6E6EA] rounded-full px-2 py-0.5">
                        <Lock className="w-3 h-3" /> Team Only
                      </span>
                    ) : null}
                    {tone ? (
                      <span
                        className={`inline-flex items-center gap-1 text-[10.5px] font-semibold rounded-full px-2 py-0.5 border ${
                          tone === "expired"
                            ? "bg-[#FDECEA] text-[#B3261E] border-[#F6CFCA]"
                            : "bg-[#FFF8E5] text-[#8A6A00] border-[#F6E7B8]"
                        }`}
                      >
                        <AlertTriangle className="w-3 h-3" />{" "}
                        {tone === "expired" ? "Expired" : "Expiring Soon"}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11.5px] text-[#77777F] mt-0.5">
                    {doc
                      ? `${doc.file_name ?? "Document"}${fmtSize(doc.size_bytes) ? ` · ${fmtSize(doc.size_bytes)}` : ""} · Uploaded ${fmtDateTime(doc.created_at)}${
                          doc.expires_at ? ` · Expires ${fmtDate(doc.expires_at)}` : ""
                        }`
                      : "Not On File"}
                  </div>
                </div>

                {mode === "admin" && !readOnly && doc && cat.expiring ? (
                  <input
                    type="date"
                    defaultValue={doc.expires_at ? String(doc.expires_at).slice(0, 10) : ""}
                    onChange={async (e) => {
                      try {
                        await patchMeta({ data: { documentId: doc.id, expiresAt: e.target.value || null } });
                        await refresh();
                      } catch {
                        toast.error("Could not save expiry");
                      }
                    }}
                    className="rounded-md border border-[#DEDEE3] text-[11.5px] px-2 py-1 text-[#28282E]"
                  />
                ) : null}

                <div className="flex items-center gap-1.5 shrink-0">
                  {doc?.url ? (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded-md hover:bg-[#F4F4F6] text-[#55555E]"
                      title="View"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ) : null}
                  {!readOnly && cat.key !== "agreement" && !signedAgreementLocked(current, cat.key) ? (
                    <FileUploader
                      variant="inline"
                      label="+ Add"
                      accept="image/*,application/pdf"
                      context={title}
                      upload={(file) => uploadDoc(cat.key as DocCategory, false, file)}
                    />
                  ) : null}
                  {mode === "admin" && !readOnly && doc && cat.key !== "agreement" && !doc.signed_agreement && doc.uploaded_by_role !== "driver" ? (
                    <button
                      onClick={async () => {
                        if (!confirm("Delete this document permanently?")) return;
                        try {
                          await removeDoc({ data: { documentId: doc.id } });
                          toast.success("Document deleted");
                          await refresh();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Could not delete");
                        }
                      }}
                      className="p-1.5 rounded-md hover:bg-[#FDECEA] text-[#B3261E]"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>

              {previous.length ? (
                <div className="mt-3 ml-3 border-l border-[#EDEDF0] pl-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#77777F]">
                    <History className="w-3.5 h-3.5" /> Previous Uploads
                  </div>
                  <ul className="mt-1 divide-y divide-[#EDEDF0]">
                    {previous.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0 text-[11.5px] text-[#55555E]">
                          <div className="truncate">{d.label || d.file_name || "Document"}</div>
                          <div className="mt-0.5 text-[10.5px] text-[#77777F]">Uploaded {fmtDateTime(d.created_at)}</div>
                        </div>
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer" className="shrink-0 text-[11.5px] font-semibold text-[#D03020]">
                            View
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {mode === "admin" && !readOnly ? (
        <FileUploader
          variant="inline"
          label="Upload Team-Only Document"
          accept="image/*,application/pdf"
          context="Team-Only Document"
          upload={(file) => uploadDoc("other", true, file)}
          className="text-[#55555E]"
        />
      ) : null}
    </div>
  );
}

export default DocumentVault;
