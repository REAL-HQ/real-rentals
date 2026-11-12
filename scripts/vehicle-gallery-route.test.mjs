/**
 * A public vehicle with no published listing photo can still show one gallery
 * original. The file is chosen here, never by a path the browser sends.
 *
 * The path route stays published-only. This route must not become a second
 * way to fetch an arbitrary private file, a retouch, or a photo of a vehicle
 * the public site does not list.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  galleryContentType,
  galleryFallbackUrl,
  isGalleryImagePath,
  isPublicVehicleId,
  listingHasPublishedPhoto,
  pickGalleryFallback,
} from "../src/lib/gallery-photo.ts";

const route = readFileSync("src/routes/api/public/vehicle-gallery/$id.ts", "utf8");
const card = readFileSync("src/lib/public-vehicle-card.ts", "utf8");
const detail = readFileSync("src/routes/fleet.$id.tsx", "utf8");
const pathRoute = readFileSync("src/routes/api/public/vehicle-photos/$.ts", "utf8");

const original = (over) => ({
  kind: "original",
  storage_bucket: "vehicle-photos",
  storage_path: "veh/shot.jpg",
  mime_type: "image/jpeg",
  is_primary: false,
  sort_order: 0,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

assert.equal(listingHasPublishedPhoto(["veh/published.jpg"]), true);
assert.equal(listingHasPublishedPhoto([]), false);
assert.equal(listingHasPublishedPhoto(null), false);
assert.equal(listingHasPublishedPhoto(["", "  "]), false);

assert.equal(pickGalleryFallback([]), null);
assert.equal(
  pickGalleryFallback([
    original({ storage_path: "veh/later.jpg", sort_order: 2, created_at: "2026-02-01T00:00:00Z" }),
    original({ storage_path: "veh/lead.jpg", is_primary: true, sort_order: 5 }),
    original({ storage_path: "veh/first.jpg", sort_order: 0, created_at: "2026-01-01T00:00:00Z" }),
  ])?.storage_path,
  "veh/lead.jpg",
);
assert.equal(
  pickGalleryFallback([
    original({ storage_path: "veh/b.jpg", sort_order: 2 }),
    original({ storage_path: "veh/a.jpg", sort_order: 1 }),
  ])?.storage_path,
  "veh/a.jpg",
);
assert.equal(
  pickGalleryFallback([original({ kind: "ai_enhanced", storage_path: "veh/retouch.jpg" })]),
  null,
);
assert.equal(
  pickGalleryFallback([
    original({ storage_bucket: "vehicle-docs", storage_path: "veh/title.jpg" }),
  ]),
  null,
);
assert.equal(pickGalleryFallback([original({ storage_path: "veh/../secret.jpg" })]), null);
assert.equal(pickGalleryFallback([original({ storage_path: "veh/registration.pdf" })]), null);
assert.equal(isGalleryImagePath("veh/shot.jpg"), true);
assert.equal(galleryContentType("veh/shot.jpg", "image/jpeg"), "image/jpeg");
assert.equal(galleryContentType("veh/shot.jpg", "text/html"), "image/jpeg");
assert.equal(galleryFallbackUrl("abc"), "/api/public/vehicle-gallery/abc");
assert.equal(isPublicVehicleId("061cb5e9-27e7-48a4-b71b-5172f31af12c"), true);
assert.equal(isPublicVehicleId("not-an-id"), false);
assert.equal(isPublicVehicleId("../etc/passwd"), false);

assert.match(route, /vehicles_public/);
assert.match(route, /listingHasPublishedPhoto/);
assert.match(route, /eq\("kind", "original"\)/);
assert.match(route, /eq\("storage_bucket", "vehicle-photos"\)/);
assert.match(route, /\.order\("is_primary", \{ ascending: false \}\)/);
assert.match(route, /\.download\(path\)/);
assert.doesNotMatch(route, /condition_media|vehicle-docs|createSignedUrl|ai_enhanced/);
assert.match(pathRoute, /\.eq\("published", true\)/);
assert.match(card, /galleryFallbackUrl/);
assert.match(detail, /galleryFallbackUrl/);
assert.match(detail, /representativePhoto/);

console.log(
  "PASS gallery fallback serves one original and leaves the published-photo route unchanged",
);
