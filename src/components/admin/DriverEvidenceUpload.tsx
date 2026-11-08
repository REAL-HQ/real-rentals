import { FileUploader } from "@/components/FileUploader";
import { DOC_CATEGORIES, type DocCategory, type VaultDocument } from "@/lib/documents.functions";
import { displayTitleCase } from "@/lib/display-normalize";
import { signedAgreementLocked } from "@/lib/signed-agreement-evidence";
import { useDriverDocumentUpload } from "./use-driver-document-upload";

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
  const upload = useDriverDocumentUpload(applicationId, onUploaded);
  const meta = DOC_CATEGORIES.find((item) => item.key === category);
  if (!meta) return null;
  if (signedAgreementLocked(documents, category)) return <p className="text-xs text-muted-foreground">Agreement Already On File · Open Documents To Review. Permanent Agreements Cannot Be Replaced.</p>;
  const label = LABELS[category] ?? displayTitleCase(meta.label);
  return <FileUploader
    variant="zone"
    title={`Drop ${label} Here`}
    label={`Browse ${label}`}
    hint={category === "agreement" ? "Signed Paper Copy · Owner/Manager Review Required" : category === "insurance" ? "Insurance Document · Verification Remains Separate" : "Images Or PDF · 15 MB Max"}
    accept="image/*,application/pdf"
    maxBytes={15 * 1024 * 1024}
    autoStart={false}
    submitLabel="Upload File"
    upload={(file, { onProgress }) => upload(category, file, onProgress)}
    className="min-w-0 [&>div:first-child]:rounded-lg [&>div:first-child]:p-3 [&_svg.mx-auto]:h-4 [&_svg.mx-auto]:w-4 [&_div.mt-4]:mt-2 [&_button]:text-xs [&_button]:whitespace-normal"
  />;
}