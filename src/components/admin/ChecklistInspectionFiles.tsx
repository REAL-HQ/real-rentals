import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createConditionUploadUrl, confirmConditionUpload, listConditionMedia, type ConditionMedia } from "@/lib/inspections.functions";
import type { VaultDocument } from "@/lib/documents.functions";
import { checklistInspectionPhotos, pickupInspectionCaption, PICKUP_INSPECTION_REPORT_LABEL } from "./checklist-actions";
import { useDriverDocumentUpload } from "./use-driver-document-upload";
import { DriverDocumentUploadDialog } from "./DriverDocumentUploadDialog";
import { ChecklistFileViewer } from "./ChecklistFileViewer";

/** Uploading evidence never starts or passes an inspection. */
export function ChecklistInspectionFiles({ applicationId, vehicleId, documents, onUploaded }: {
  applicationId: string; vehicleId: string | null; documents: VaultDocument[]; onUploaded: () => Promise<void> | void;
}) {
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [photos, setPhotos] = useState<ConditionMedia[]>([]);
  const [rentalId, setRentalId] = useState<string | null>(null);
  const start = useServerFn(createConditionUploadUrl);
  const confirm = useServerFn(confirmConditionUpload);
  const list = useServerFn(listConditionMedia);
  const uploadDocument = useDriverDocumentUpload(applicationId, onUploaded);
  const refresh = useCallback(async () => {
    setPhotos([]);
    setRentalId(null);
    if (!vehicleId) return;
    const rental = await supabase.from("rentals").select("id").eq("application_id", applicationId).eq("vehicle_id", vehicleId).eq("status", "active").maybeSingle();
    if (rental.error) throw rental.error;
    const id = rental.data?.id ?? null;
    const rows = await list({ data: { vehicleId, ...(id ? { rentalId: id } : {}) } });
    setRentalId(id);
    setPhotos(checklistInspectionPhotos(rows, vehicleId, applicationId, id));
  }, [applicationId, vehicleId, list]);
  useEffect(() => { void refresh().catch(() => setPhotos([])); }, [refresh]);
  const reports = documents.filter((doc) => doc.is_current && doc.category === "other" && doc.label === PICKUP_INSPECTION_REPORT_LABEL);
  const files = [...photos.map((photo, index) => ({ title: `Pickup Photo ${index + 1}`, url: photo.url, mimeType: "image/jpeg", fileName: null })), ...reports.map((report) => ({ title: report.file_name ?? "Inspection Report", url: report.url, mimeType: report.mime_type, fileName: report.file_name }))];
  async function uploadPhoto(file: File, onProgress: (pct: number) => void) {
    if (!vehicleId) throw new Error("Assign A Vehicle Before Adding Pickup Photos.");
    onProgress(10);
    const signed = await start({ data: { vehicleId, fileName: file.name, mimeType: file.type } });
    if (!signed.path.startsWith(`${vehicleId}/`)) throw new Error("Photo Destination Could Not Be Confirmed.");
    onProgress(40);
    const stored = await supabase.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
    if (stored.error) throw stored.error;
    onProgress(80);
    await confirm({ data: { vehicleId, rentalId, phase: "checkout", angle: "other", caption: pickupInspectionCaption(applicationId), path: signed.path, fileName: file.name, mimeType: file.type, sizeBytes: file.size } });
    onProgress(100);
    await refresh();
    await onUploaded();
  }
  return <>
    <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" title="Add Pre-Inspection Files" aria-label="Add Pre-Inspection Files" onClick={() => setAdding(true)}><Plus className="h-3 w-3" />Add</Button>
    {files.length ? <Button variant="outline" size="sm" className="h-7 text-[11px]" title="View Pre-Inspection Files" aria-label="View Pre-Inspection Files" onClick={() => setViewing(true)}>View</Button> : null}
    {adding ? <DriverDocumentUploadDialog label="Pre-Inspection Files" upload={(file, { onProgress }) => uploadPhoto(file, onProgress)} choices={[
      ...(vehicleId ? [{ label: "Pickup Photos", accept: "image/*", multiple: true, maxBytes: 50 * 1024 * 1024, hint: "Pickup Photos · 50 MB Max", upload: (file: File, { onProgress }: { onProgress: (pct: number) => void }) => uploadPhoto(file, onProgress) }] : []),
      { label: "Inspection Report", hint: vehicleId ? "Optional Inspection Report · Images Or PDF · 15 MB Max" : "Assign A Vehicle To Add Pickup Photos. Inspection Report Is Optional.", upload: (file, { onProgress }) => uploadDocument("other", file, onProgress, { label: PICKUP_INSPECTION_REPORT_LABEL }) },
    ]} onClose={() => setAdding(false)} /> : null}
    {viewing ? <ChecklistFileViewer title="Pre-Inspection Files" files={files} onClose={() => setViewing(false)} /> : null}
  </>;
}