// Guard: new code must use <FileUploader> (src/components/FileUploader.tsx).
// Existing raw <input type="file"> sites are grandfathered below; they get
// drag-and-drop from the global FileDropBridge. Adding a new raw file input
// fails this check — use FileUploader, or add the file here with a reason.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "src/components/FileUploader.tsx", // the shared uploader itself
  "src/components/FileDropBridge.tsx", // page-level drop safety net
  "src/components/site/ApplicationWizard.tsx", // trip screenshots: per-row Retake replaces a specific stored file
]);

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(tsx|jsx|ts)$/.test(f) ? [p] : []; });
const offenders = walk("src").filter((p) => /type=["']file["']/.test(readFileSync(p, "utf8")) && !ALLOWED.has(p.replaceAll("\\", "/")));
if (offenders.length) {
  console.error("New raw file inputs found — use <FileUploader> instead:\n  " + offenders.join("\n  "));
  process.exit(1);
}
console.log(`file-upload-guard: OK (${ALLOWED.size} known upload sites)`);
