// Guard: new code must use <FileUploader> (src/components/FileUploader.tsx).
// Existing raw <input type="file"> sites are grandfathered below; they get
// drag-and-drop from the global FileDropBridge. Adding a new raw file input
// fails this check — use FileUploader, or add the file here with a reason.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "src/components/FileUploader.tsx",
  "src/components/FileDropBridge.tsx",
  "src/components/admin/modal.tsx", // UploadDropzone (own drop handling)
  "src/components/admin/FleetInboxPanel.tsx", // Fleet Inbox zone (own drop handling, AI pipeline)
  "src/routes/partners.tsx",
  "src/components/admin/ExpensesPanel.tsx",
  "src/components/admin/VehicleDocuments.tsx",
  "src/components/admin/InspectionsPanel.tsx",
  "src/components/admin/TitleScanStep.tsx",
  "src/components/admin/ImportVehiclesStep.tsx",
  "src/components/site/ApplicationWizard.tsx",
  "src/components/admin/DocumentVault.tsx",
  "src/components/site/DocumentCapture.tsx",
  "src/components/admin/VerificationRecording.tsx",
  "src/components/admin/VehiclePhotos.tsx",
  "src/components/admin/ApplicantDocuments.tsx",
]);

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(tsx|jsx)$/.test(f) ? [p] : []; });
const offenders = walk("src").filter((p) => /type=["']file["']/.test(readFileSync(p, "utf8")) && !ALLOWED.has(p.replaceAll("\\", "/")));
if (offenders.length) {
  console.error("New raw file inputs found — use <FileUploader> instead:\n  " + offenders.join("\n  "));
  process.exit(1);
}
console.log(`file-upload-guard: OK (${ALLOWED.size} known upload sites)`);
