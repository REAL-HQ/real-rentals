/**
 * Enlarged owner-vehicle photos step through the set.
 * Run: bun test scripts/owner-vehicle-photo-lightbox.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  OwnerVehiclePhotoGrid,
  OwnerVehiclePhotoLightbox,
  stepPhotoIndex,
} from "../src/components/admin/owner-vehicle-photos.tsx";

const paths = ["sample/front.jpg", "sample/side.jpg", "sample/rear.jpg"];
const previewUrls = {
  "sample/front.jpg": swatch("#B9C4CE", "Front"),
  "sample/side.jpg": swatch("#D7C4A3", "Side"),
  "sample/rear.jpg": swatch("#C9B4C4", "Rear"),
};

describe("owner vehicle photo lightbox", () => {
  it("wraps at either end and stays put when there is only one photo", () => {
    assert.equal(stepPhotoIndex(0, 8, -1), 7);
    assert.equal(stepPhotoIndex(7, 8, 1), 0);
    assert.equal(stepPhotoIndex(2, 8, 1), 3);
    assert.equal(stepPhotoIndex(0, 1, 1), null);
    assert.equal(stepPhotoIndex(0, 1, -1), null);
    assert.equal(stepPhotoIndex(3, 8, 0), null);
  });

  it("shows circular previous and next controls, a counter, and Close", () => {
    const html = renderToStaticMarkup(
      createElement(OwnerVehiclePhotoLightbox, {
        paths,
        index: 1,
        previewUrls,
        onIndex: () => {},
        onClose: () => {},
      }),
    );
    assert.match(html, /data-testid="owner-photo-lightbox"/);
    assert.match(html, /aria-label="Vehicle Photo 2"/);
    assert.match(html, /aria-label="Previous Photo"/);
    assert.match(html, /title="Previous Photo"/);
    assert.match(html, /aria-label="Next Photo"/);
    assert.match(html, /title="Next Photo"/);
    assert.match(html, /data-testid="owner-photo-previous"/);
    assert.match(html, /data-testid="owner-photo-next"/);
    assert.match(html, /rounded-full/);
    assert.match(html, /bg-white/);
    assert.match(html, /shadow-md/);
    assert.match(html, />Close</);
    assert.match(html, /data-testid="owner-photo-counter"/);
    assert.match(html, /2 \/ 3/);
    assert.match(html, /alt="Vehicle Photo 2"/);
    assert.doesNotMatch(html, /createSignedUrl/);
  });

  it("hides the arrows when the submission has one photo", () => {
    const html = renderToStaticMarkup(
      createElement(OwnerVehiclePhotoLightbox, {
        paths: ["sample/only.jpg"],
        index: 0,
        previewUrls: { "sample/only.jpg": swatch("#D6D6DB", "Only") },
        onIndex: () => {},
        onClose: () => {},
      }),
    );
    assert.match(html, />Close</);
    assert.match(html, /1 \/ 1/);
    assert.doesNotMatch(html, /Previous Photo/);
    assert.doesNotMatch(html, /Next Photo/);
    assert.doesNotMatch(html, /owner-photo-previous/);
    assert.doesNotMatch(html, /owner-photo-next/);
  });

  it("keeps the grid closed until a photo is opened, and still signs through the shared hook", () => {
    const html = renderToStaticMarkup(createElement(OwnerVehiclePhotoGrid, { paths, previewUrls }));
    assert.match(html, /data-testid="owner-photo-grid"/);
    assert.match(html, /Open Photo 1/);
    assert.doesNotMatch(html, /owner-photo-lightbox/);
    const source = readFileSync("src/components/admin/owner-vehicle-photos.tsx", "utf8");
    assert.match(source, /from\("owner-vehicle-photos"\)\s*\.createSignedUrl/);
    assert.equal(source.match(/createSignedUrl/g)?.length, 1);
    assert.match(source, /ArrowLeft/);
    assert.match(source, /ArrowRight/);
    assert.match(source, /Escape/);
    assert.match(
      readFileSync("src/components/admin/PartnersPanel.tsx", "utf8"),
      /OwnerVehiclePhotoGrid/,
    );
    assert.match(
      readFileSync("src/components/admin/FleetOwnersPanel.tsx", "utf8"),
      /OwnerVehiclePhotoGrid/,
    );
  });
});

function swatch(fill: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="${fill}"/><text x="320" y="220" text-anchor="middle" font-size="48" font-family="sans-serif" fill="#111114">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
