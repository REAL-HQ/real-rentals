import { useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createDocumentUploadUrl, confirmDocumentUpload, type DocCategory } from "@/lib/documents.functions";

/** The existing vault upload sequence, shared by Documents and readiness. */
export function useDriverDocumentUpload(applicationId: string, onUploaded: () => Promise<void> | void) {
  const startUpload = useServerFn(createDocumentUploadUrl);
  const confirmUpload = useServerFn(confirmDocumentUpload);
  return useCallback(async (category: DocCategory, file: File, onProgress: (pct: number) => void, options?: { label?: string; replacesDocumentId?: string }) => {
    onProgress(10);
    const signed = await startUpload({ data: { applicationId, category, fileName: file.name, mimeType: file.type || "application/octet-stream" } });
    if (signed.applicationId !== applicationId) throw new Error("Document destination could not be confirmed. Nothing was uploaded.");
    onProgress(40);
    const { error } = await supabase.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, file);
    if (error) throw new Error(error.message);
    onProgress(80);
    const confirmed = await confirmUpload({ data: { applicationId: signed.applicationId, category, path: signed.path, fileName: file.name, mimeType: file.type || null, sizeBytes: file.size, ...(options?.label ? { label: options.label } : {}), ...(options?.replacesDocumentId ? { replacesDocumentId: options.replacesDocumentId } : {}) } });
    onProgress(100);
    await onUploaded();
    // The saved document's id, for callers that link it (RentID reports).
    return (confirmed as { id?: string } | undefined)?.id ?? null;
  }, [applicationId, startUpload, confirmUpload, onUploaded]);
}