import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOC_CATEGORIES, type DocCategory, type VaultDocument } from "@/lib/documents.functions";
import { displayTitleCase } from "@/lib/display-normalize";
import { signedAgreementLocked } from "@/lib/signed-agreement-evidence";
import { useDriverDocumentUpload } from "./use-driver-document-upload";
import { DriverDocumentUploadDialog } from "./DriverDocumentUploadDialog";

const LABELS: Partial<Record<DocCategory, string>> = {
  license_front: "Driver's License (Front)",
  license_back: "Driver's License (Back)",
  insurance: "Insurance Card",
  agreement: "Signed Agreement",
  gig_profile: "Gig Profile Screenshot",
};

export function DriverEvidenceUpload({ applicationId, category, documents, onUploaded }: {
  applicationId: string;
  category: DocCategory;
  documents: VaultDocument[];
  onUploaded: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const upload = useDriverDocumentUpload(applicationId, onUploaded);
  const meta = DOC_CATEGORIES.find((item) => item.key === category);
  if (!meta) return null;
  if (signedAgreementLocked(documents, category)) return <span className="text-[11px] text-muted-foreground">Agreement On File · Review In Documents</span>;
  const label = LABELS[category] ?? displayTitleCase(meta.label);
  const shortLabel = category === "license_front" ? "Front" : category === "license_back" ? "Back" : null;
  return <>
    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-[11px]" aria-label={`Add ${label}`} title={`Add ${label}`} onClick={() => setOpen(true)}>
      <Plus className="h-3 w-3" /> Add{shortLabel ? ` ${shortLabel}` : ""}
    </Button>
    {open ? <DriverDocumentUploadDialog label={label}
      hint={category === "agreement" ? "Signed Paper Copy · Owner/Manager Review Required" : category === "insurance" ? "Insurance Document · Verification Remains Separate" : undefined}
      upload={(file, { onProgress }) => upload(category, file, onProgress)} onClose={() => setOpen(false)} /> : null}
  </>;
}