/**
 * Regression: resolving an activation requirement must refresh every mounted
 * presentation of that requirement. These are wiring assertions, not copies
 * of the activation rules; the server remains the authority.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readiness = readFileSync("src/lib/activation-readiness.ts", "utf8");
const activation = readFileSync("src/components/admin/ActivateRentalDialog.tsx", "utf8");
const drivers = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
const vehicleDocs = readFileSync("src/components/admin/VehicleDocuments.tsx", "utf8");
const upload = readFileSync("src/components/admin/VehicleDocUploadDialog.tsx", "utf8");
const profile = readFileSync("src/components/admin/VehicleProfile.tsx", "utf8");

assert.match(
  readiness,
  /ACTIVATION_READINESS_REFRESH_EVENT/,
  "a shared refresh signal must exist for committed readiness changes",
);
assert.match(
  drivers,
  /notifyActivationReadinessRefresh\(\{\s*applicationId:\s*driver\.id\s*\}\)/,
  "driver document, screening, and insurance saves must announce the affected applicant",
);
assert.match(
  activation,
  /addEventListener\(ACTIVATION_READINESS_REFRESH_EVENT/,
  "an open activation dialog must listen for resolved driver requirements",
);
assert.match(
  activation,
  /addEventListener\("focus"/,
  "an open activation dialog must recheck after returning from another tab",
);
assert.match(
  activation,
  /\[driver\.id, vehicleId, refreshNonce\]/,
  "the readiness request must depend on the refresh revision, not only the selected ids",
);
assert.match(
  vehicleDocs,
  /onDocumentChanged=\{\(\) => void documentsChanged\(\)\}/,
  "vehicle paperwork saves must reload the profile and readiness derived from them",
);
assert.match(
  upload,
  /onDocumentChanged\?\.\(\)/,
  "the document reader must distinguish committed saves from refused proposal applications",
);
assert.match(
  profile,
  /onVehicleChanged=\{afterSave\}/,
  "accepted vehicle details must refresh both the profile and its parent list",
);

console.log("PASS activation requirement changes refresh vehicle, document, and activation details");
