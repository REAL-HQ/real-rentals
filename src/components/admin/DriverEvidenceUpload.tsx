import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOC_CATEGORIES, type DocCategory, type VaultDocument } from "@/lib/documents.functions";
import { displayTitleCase } from "@/lib/display-normalize";
import { signedAgreementLocked } from "@/lib/signed-agreement-evidence";
import { useDriverDocumentUpload } from "./use-driver-document-upload";
import { DriverDocumentUploadDialog } from "./DriverDocumentUploadDialog";
import { ChecklistFileViewer } from "./ChecklistFileViewer";

const LABELS: Partial<Record<DocCategory, string>> = {
  license_front: "Driver's License (Front)",
  license_back: "Driver's License (Back)",
  insurance: "Insurance Card",
  agreement: "Signed Agreement",
  gig_profile: "Gig Profile Screenshot",
};

export function DriverEvidenceUpload({ applicationId, category, documents, onUploaded, categories }: {
  applicationId: string;
  category: DocCategory;
  documents: VaultDocument[];
  onUploaded: () => Promise<void> | void;
  categories?: DocCategory[];
}) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const upload = useDriverDocumentUpload(applicationId, onUploaded);
  const meta = DOC_CATEGORIES.find((item) => item.key === category);
  if (!meta) return null;
  const locked = signedAgreementLocked(documents, category);
  const license = categories?.includes("license_front") && categories.includes("license_back");
  const label = license ? "Driver's License" : LABELS[category] ?? displayTitleCase(meta.label);
  const matching = documents.filter((doc) => doc.is_current && (categories ?? [category]).includes(doc.category as DocCategory));
  return <>
    {!locked ? <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-[11px]" aria-label={`Add ${label}`} title={`Add ${label}`} onClick={() => setOpen(true)}>
      <Plus className="h-3 w-3" /> Add
    </Button> : null}
    {matching.length ? <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" aria-label={`View ${label}`} title={`View ${label}`} onClick={() => setViewing(true)}>View</Button> : null}
    {viewing ? <ChecklistFileViewer title={label} files={matching.map((doc) => ({ title: doc.file_name ?? LABELS[doc.category as DocCategory] ?? label, url: doc.url, fileName: doc.file_name, mimeType: doc.mime_type }))} onClose={() => setViewing(false)} /> : null}
    {open ? <DriverDocumentUploadDialog label={label}
      choices={license ? [
        { label: "Front", upload: (file, { onProgress }) => upload("license_front", file, onProgress) },
        { label: "Back", upload: (file, { onProgress }) => upload("license_back", file, onProgress) },
      ] : undefined}
      hint={category === "agreement" ? "Signed Paper Copy · Owner/Manager Review Required" : category === "insurance" ? "Insurance Document · Verification Remains Separate" : undefined}
      upload={(file, { onProgress }) => upload(category, file, onProgress)} onClose={() => setOpen(false)} /> : null}
  </>;
}