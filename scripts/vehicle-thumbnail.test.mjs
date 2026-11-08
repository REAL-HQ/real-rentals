import assert from "node:assert/strict";
import {
  chooseVehicleThumbnailPaths,
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
  { id: "a-1", vehicle_id: A, storage_path: "a/first.jpg" },
  { id: "a-2", vehicle_id: A, storage_path: "a/chosen.jpg" },
  { id: "b-1", vehicle_id: B, storage_path: "b/first.jpg" },
];

check(vehicleListThumbnailKey(A) === "vehicle_list_thumbnail:vehicle-a", "each vehicle has an independent setting key");
check(readVehicleListThumbnailMediaId({ mediaId: "a-2" }) === "a-2", "a valid selection is read");
check(readVehicleListThumbnailMediaId({ mediaId: "" }) === null, "a blank selection is ignored");
check(readVehicleListThumbnailMediaId(null) === null, "a missing selection is ignored");

const chosen = chooseVehicleThumbnailPaths(media, [
  { key: vehicleListThumbnailKey(A), value: { mediaId: "a-2" } },
]);
check(chosen.get(A) === "a/chosen.jpg", "the explicitly selected original becomes the staff thumbnail");
check(chosen.get(B) === "b/first.jpg", "another vehicle keeps its own fallback thumbnail");

const stale = chooseVehicleThumbnailPaths(media, [
  { key: vehicleListThumbnailKey(A), value: { mediaId: "deleted-photo" } },
  { key: "unrelated_setting", value: { mediaId: "b-1" } },
]);
check(stale.get(A) === "a/first.jpg", "a deleted or cross-vehicle selection falls back safely");
check(stale.get(B) === "b/first.jpg", "unrelated settings never change thumbnails");
check(media[0].storage_path === "a/first.jpg" && media.length === 3, "selection never rewrites photo metadata or public ordering");

console.log(`${checks} vehicle thumbnail checks passed`);
