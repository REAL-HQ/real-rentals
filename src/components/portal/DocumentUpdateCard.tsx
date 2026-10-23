import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import {
  confirmDocumentUpload,
  createDocumentUploadUrl,
  type DocCategory,
} from "@/lib/documents.functions";
import { fmtDate } from "@/lib/date-format";
import type { PortalDocumentUpdateItem } from "@/lib/portal-document-update";

const MAX_BYTES = 15 * 1024 * 1024;

function reasonLine(item: PortalDocumentUpdateItem): string {
  if (item.reason === "missing") return "Not on file";
  const when = item.expiresOn ? fmtDate(item.expiresOn) : "";
  if (item.reason === "expired") return when ? `Expired ${when}` : "Expired";
  return when ? `Expires ${when}` : "Expiring soon";
}

/**
 * Upload control for one license or insurance file.
 *
 * Same sequence as DocumentVault's driver Replace: a signed upload URL from
 * createDocumentUploadUrl, bytes to the bucket that function returns
 * (driver-docs), then confirmDocumentUpload. Confirm inserts a new current
 * row and supersedes the previous one. Nothing here deletes a row or an
 * object, and nothing marks the file verified.
 */
export function DocumentUpdateCard({
  items,
  readOnly,
  onUploaded,
}: {
  items: PortalDocumentUpdateItem[];
  readOnly: boolean;
  onUploaded: () => void;
}) {
  const startUpload = useServerFn(createDocumentUploadUrl);
  const confirmUpload = useServerFn(confirmDocumentUpload);

  async function uploadDoc(category: DocCategory, file: File) {
    if (file.size > MAX_BYTES) throw new Error("Files must be under 15 MB");
    try {
      const signed = await startUpload({
        data: {
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
          mimeType: file.type || (null as any),
          sizeBytes: file.size,
          internal: false,
        },
      });
      toast.success("Document uploaded");
      onUploaded();
    } catch (err: any) {
      throw new Error(err?.message || "Upload failed");
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <h2 className="font-semibold">Update Your Documents</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your license or insurance needs a current file. Uploading keeps the previous one in your history.
      </p>
      {readOnly ? (
        <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Uploads are disabled in Driver Preview.
        </p>
      ) : null}
      <ul className="mt-4 divide-y divide-border">
        {items.map((item) => (
          <li key={item.category} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-xs text-muted-foreground">{reasonLine(item)}</div>
            </div>
            {readOnly ? null : (
              <FileUploader
                variant="inline"
                label="Upload"
                accept="image/*,application/pdf"
                maxBytes={MAX_BYTES}
                context={item.label}
                upload={(file) => uploadDoc(item.category, file)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
