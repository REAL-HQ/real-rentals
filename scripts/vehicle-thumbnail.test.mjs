import assert from "node:assert/strict";
import {
  chooseVehicleThumbnailPaths,
  readConfirmedCarMediaIds,
  readVehicleListThumbnailMediaId,
  vehicleListThumbnailKey,
} from "../src/lib/vehicle-thumbnail.ts";

let checks = 0;
const check = (condition, label) => {
  assert.equal(condition, true, label);
  checks += 1;
  console.log("PASS", label);
};

const A = "vehicle-a";
const B = "vehicle-b";
const media = [
  { id: "a-document", vehicle_id: A, storage_path: "a/rental-agreement.jpg" },
  { id: "a-car", vehicle_id: A, storage_path: "a/car.jpg" },
  { id: "b-document", vehicle_id: B, storage_path: "b/odometer.jpg" },
  { id: "b-car", vehicle_id: B, storage_path: "b/car.jpg" },
];

check(vehicleListThumbnailKey(A) === "vehicle_list_thumbnail:vehicle-a", "each vehicle has an independent setting key");
check(readVehicleListThumbnailMediaId({ mediaId: "a-car" }) === "a-car", "a valid selection is read");
check(readVehicleListThumbnailMediaId({ mediaId: "" }) === null, "a blank selection is ignored");
check(readVehicleListThumbnailMediaId(null) === null, "a missing selection is ignored");
check(readConfirmedCarMediaIds({ carMediaIds: ["a-car", "a-car", "", 4] }).join(",") === "a-car", "confirmed car ids are valid and unique");
check(readConfirmedCarMediaIds({ mediaId: "a-car" }).length === 0, "an older unconfirmed selection is not trusted as a car photo");

const unclassified = chooseVehicleThumbnailPaths(media, []);
check(!unclassified.has(A) && !unclassified.has(B), "documents and unclassified images never become automatic thumbnails");

const chosen = chooseVehicleThumbnailPaths(media, [
  { key: vehicleListThumbnailKey(A), value: { mediaId: "a-car", carMediaIds: ["a-car"] } },
  { key: vehicleListThumbnailKey(B), value: { carMediaIds: ["b-car"] } },
]);
check(chosen.get(A) === "a/car.jpg", "the explicitly selected confirmed car photo becomes the staff thumbnail");
check(chosen.get(B) === "b/car.jpg", "another vehicle falls back only to its own confirmed car photo");

const stale = chooseVehicleThumbnailPaths(media, [
  { key: vehicleListThumbnailKey(A), value: { mediaId: "deleted-photo", carMediaIds: ["a-car"] } },
  { key: "unrelated_setting", value: { mediaId: "b-document", carMediaIds: ["b-document"] } },
]);
check(stale.get(A) === "a/car.jpg", "a deleted selection falls back only to another confirmed car photo");
check(!stale.has(B), "unrelated settings never make a document eligible");
check(media[0].storage_path === "a/rental-agreement.jpg" && media.length === 4, "selection never rewrites photo metadata or public ordering");

console.log(`${checks} vehicle thumbnail checks passed`);
