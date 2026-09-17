import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, Trash2, ExternalLink, Lock, History, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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

const MAX_MB = 15;

function fmtSize(n: number | null) {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function expiryTone(d: VaultDocument): "expired" | "soon" | null {
  if (!d.expires_at) return null;
  const days = (new Date(d.expires_at).getTime() - Date.now()) / 86400000;
  if (days < 0) return "expired";
  if (days < 30) return "soon";
  return null;
}

/**
 * Shared document vault. `mode="admin"` gives the team upload/replace/delete,
 * expiry tracking and team-only visibility; `mode="driver"` lets the renter
 * view and replace their own documents.
 */
export function DocumentVault({
  mode,
  applicationId,
}: {
  mode: "admin" | "driver";
  applicationId?: string;
}) {
  const listAdmin = useServerFn(adminListDriverDocuments);
  const listMine = useServerFn(getMyVault);
  const startUpload = useServerFn(createDocumentUploadUrl);
  const confirmUpload = useServerFn(confirmDocumentUpload);
  const patchMeta = useServerFn(updateDocumentMeta);
  const removeDoc = useServerFn(deleteDocument);

  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [appId, setAppId] = useState<string | null>(applicationId ?? null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const pending = useRef<{ category: DocCategory; internal: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
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
  }, [applicationId, mode]);

  function pick(category: DocCategory, internal = false) {
    pending.current = { category, internal };
    fileInput.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const ctx = pending.current;
    if (!file || !ctx) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`Files must be under ${MAX_MB} MB`);
      return;
    }
    setUploading(ctx.category);
    try {
      const signed = await startUpload({
        data: {
          applicationId: appId ?? undefined,
          category: ctx.category,
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
          category: ctx.category,
          path: signed.path,
          fileName: file.name,
          mimeType: file.type || null as any,
          sizeBytes: file.size,
          internal: ctx.internal,
        },
      });
      toast.success("Document uploaded");
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || "Upload failed");
    } finally {
      setUploading(null);
      pending.current = null;
    }
  }

  const current = docs.filter((d) => d.is_current);
  const history = docs.filter((d) => !d.is_current);
  const categories = mode === "admin" ? DOC_CATEGORIES : DOC_CATEGORIES.filter((c) => c.key !== "agreement");

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[#55555E] py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input ref={fileInput} type="file" onChange={onFile} className="hidden" accept="image/*,application/pdf" />

      <ul className="divide-y divide-[#EDEDF0] border border-[#EDEDF0] rounded-xl overflow-hidden bg-white">
        {categories.map((cat) => {
          const doc = current.find((d) => d.category === cat.key) ?? null;
          const tone = doc ? expiryTone(doc) : null;
          return (
            <li key={cat.key} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-[#111114]">{cat.label}</span>
                  {doc && !doc.visibility.includes("driver") ? (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#77777F] bg-[#F4F4F6] border border-[#E6E6EA] rounded-full px-2 py-0.5">
                      <Lock className="w-3 h-3" /> Team only
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
                      <AlertTriangle className="w-3 h-3" /> {tone === "expired" ? "Expired" : "Expiring soon"}
                    </span>
                  ) : null}
                </div>
                <div className="text-[11.5px] text-[#77777F] mt-0.5 truncate">
                  {doc
                    ? `${doc.file_name ?? "Document"} · ${fmtSize(doc.size_bytes)} · uploaded ${new Date(doc.created_at).toLocaleDateString()}${
                        doc.expires_at ? ` · expires ${new Date(doc.expires_at).toLocaleDateString()}` : ""
                      }`
                    : "Not on file"}
                </div>
              </div>

              {mode === "admin" && doc && cat.expiring ? (
                <input
                  type="date"
                  defaultValue={doc.expires_at ? String(doc.expires_at).slice(0, 10) : ""}
                  onChange={async (e) => {
                    try {
                      await patchMeta({ data: { id: doc.id, expiresAt: e.target.value || null } });
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
                {cat.key !== "agreement" ? (
                  <button
                    onClick={() => pick(cat.key as DocCategory)}
                    disabled={uploading === cat.key}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#DEDEE3] text-[11.5px] font-semibold text-[#28282E] px-2.5 py-1.5 hover:bg-[#FAFAFB] disabled:opacity-50"
                  >
                    {uploading === cat.key ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    {doc ? "Replace" : "Upload"}
                  </button>
                ) : null}
                {mode === "admin" && doc ? (
                  <button
                    onClick={async () => {
                      if (!confirm("Delete this document permanently?")) return;
                      try {
                        await removeDoc({ data: { id: doc.id } });
                        toast.success("Document deleted");
                        await refresh();
                      } catch {
                        toast.error("Could not delete");
                      }
                    }}
                    className="p-1.5 rounded-md hover:bg-[#FDECEA] text-[#B3261E]"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {mode === "admin" ? (
        <button
          onClick={() => pick("other", true)}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#55555E] hover:text-[#111114]"
        >
          <Lock className="w-3.5 h-3.5" /> Upload team-only document
        </button>
      ) : null}

      {history.length ? (
        <div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#55555E] hover:text-[#111114]"
          >
            <History className="w-3.5 h-3.5" /> {showHistory ? "Hide" : "Show"} previous versions ({history.length})
          </button>
          {showHistory ? (
            <ul className="mt-2 divide-y divide-[#EDEDF0] border border-[#EDEDF0] rounded-xl overflow-hidden bg-[#FAFAFB]">
              {history.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-[12px] text-[#55555E] truncate">
                    {(d.label || d.file_name || d.category)} · {new Date(d.created_at).toLocaleDateString()}
                  </span>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-[#D03020]">
                      View
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default DocumentVault;
