/**
 * Legacy fleet-owner rows show a photo and open every submission field.
 * Run: bun test scripts/partner-submission-details.test.ts
 */
import { mock } from "bun:test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import * as realRouter from "@tanstack/react-router";
import * as realStart from "@tanstack/react-start";
import type { FleetOwner } from "../src/components/admin/types";
import { OWNER_VEHICLE_PHOTO_TTL_SECONDS } from "../src/components/admin/owner-vehicle-photos";

mock.module("@tanstack/react-router", () => ({
  ...realRouter,
  useNavigate: () => () => {},
  Link: ({ children, className }: { children?: ReactNode; className?: string }) =>
    createElement("a", { className }, children),
}));
mock.module("@tanstack/react-start", () => ({
  ...realStart,
  useServerFn: () => async () => ({}),
}));
mock.module("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) },
}));

const { PartnersPanel } = await import("../src/components/admin/PartnersPanel.tsx");

const front = swatch("#D6D6DB", "Front");
const side = swatch("#C8C8CE", "Side");
const rear = swatch("#E4E4E8", "Rear");

const withPhotos = owner({
  id: "jordan",
  full_name: "Jordan Hale",
  email: "jordan.hale@example.com",
  phone: "(813) 555-0142",
  photo_urls: ["sample/jordan-front.jpg", "sample/jordan-side.jpg"],
});
const collapsedPhoto = owner({
  id: "priya",
  full_name: "Priya Shah",
  email: "priya.shah@example.com",
  phone: "(727) 555-0199",
  year: 2018,
  make: "Toyota",
  model: "Camry",
  trim: "SE",
  vin: "4T1B11HK5JU000222",
  photo_urls: ["sample/priya-rear.jpg"],
});
const noPhoto = owner({
  id: "luis",
  full_name: "Luis Ortega",
  email: "luis.ortega@example.com",
  phone: "(941) 555-0170",
  year: 2016,
  make: "Hyundai",
  model: "Elantra",
  trim: null,
  vin: "5NPD84LF7GH000333",
  mileage: null,
  title_status: null,
  lien_status: "Lien",
  currently_insured: false,
  message: null,
  photo_urls: [],
});

const photoUrls = {
  "sample/jordan-front.jpg": front,
  "sample/jordan-side.jpg": side,
  "sample/priya-rear.jpg": rear,
};

describe("legacy submission details", () => {
  it("signs owner vehicle photos for one hour and does not sign them twice", () => {
    assert.equal(OWNER_VEHICLE_PHOTO_TTL_SECONDS, 3600);
    const shared = readFileSync("src/components/admin/owner-vehicle-photos.tsx", "utf8");
    const partners = readFileSync("src/components/admin/PartnersPanel.tsx", "utf8");
    const fleet = readFileSync("src/components/admin/FleetOwnersPanel.tsx", "utf8");
    assert.match(shared, /from\("owner-vehicle-photos"\)\.createSignedUrl/);
    assert.doesNotMatch(partners, /createSignedUrl/);
    assert.doesNotMatch(fleet, /createSignedUrl/);
    assert.match(partners, /OwnerVehiclePhotoThumb/);
    assert.match(fleet, /OwnerVehiclePhotoGrid/);
  });

  it("shows a collapsed thumbnail or a no-photo state, and the open row lists every field", () => {
    const html = renderToStaticMarkup(createElement(PartnersPanel, { preview: samplePreview() }));
    const rows = html.split('data-testid="legacy-owner-row"').slice(1);
    assert.equal(rows.length, 3);
    assert.match(rows[0], /aria-expanded="true"/);
    assert.match(rows[0], /data-testid="owner-photo-thumb"/);
    assert.match(rows[0], /data-testid="legacy-owner-details"/);
    assert.match(rows[0], /data-testid="owner-photo-grid"/);
    assert.match(rows[0], /Open Photo 1/);
    assert.match(rows[0], /Open Photo 2/);
    for (const label of [
      "Phone",
      "VIN",
      "Year",
      "Make",
      "Model",
      "Trim",
      "Mileage",
      "Title Status",
      "Lien Status",
      "Registration State",
      "Currently Insured",
      "Condition",
      "Status",
      "Created",
      "Message",
      "Photos",
    ]) {
      assert.match(rows[0], new RegExp(`>${label}<`));
    }
    assert.match(rows[0], /\(813\) 555-0142/);
    assert.match(rows[0], /1HGCV1F3XKA000001/);
    assert.match(rows[0], /48,210 mi/);
    assert.match(rows[0], />Yes</);
    assert.match(rows[0], /Ready to place this car/);
    assert.match(rows[1], /data-testid="owner-photo-thumb"/);
    assert.match(rows[1], /aria-expanded="false"/);
    assert.doesNotMatch(rows[1], /legacy-owner-details/);
    assert.match(rows[1], new RegExp(rear.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(rows[2], /data-testid="owner-photo-empty"/);
    assert.match(rows[2], /No Photo/);
    assert.doesNotMatch(rows[2], /owner-photo-thumb/);
    assert.equal(html.match(/Convert To Partner/g)?.length, 3);
  });
});

function samplePreview() {
  return {
    owners: [withPhotos, collapsedPhoto, noPhoto],
    photoUrls,
    expandedOwnerId: "jordan",
  };
}

if (process.env.WRITE_PARTNER_HTML === "1") {
  const body = renderToStaticMarkup(createElement(PartnersPanel, { preview: samplePreview() }));
  const page = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5173/src/styles.css"></head><body class="bg-[#F6F6F7]"><div class="flex min-h-screen"><aside class="w-[220px] shrink-0 bg-[#111114]"></aside><main class="min-w-0 flex-1 px-8 py-6"><h1 class="mb-4 text-lg font-semibold">Partners · Legacy Submissions</h1>${body}</main></div></body></html>`;
  writeFileSync("/tmp/partner-submissions.html", page);
}

function owner(partial: Partial<FleetOwner> & Pick<FleetOwner, "id" | "full_name" | "email" | "phone" | "photo_urls">): FleetOwner {
  return {
    year: 2019,
    make: "Honda",
    model: "Accord",
    trim: "EX-L",
    vin: "1HGCV1F3XKA000001",
    mileage: 48210,
    title_status: "In Hand",
    lien_status: "Free And Clear",
    registration_state: "FL",
    currently_insured: true,
    condition: "Good",
    message: "Ready to place this car.",
    status: "new",
    notes: null,
    created_at: "2026-11-20T15:00:00.000Z",
    ...partial,
  };
}

function swatch(fill: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="${fill}"/><text x="320" y="220" text-anchor="middle" font-size="48" font-family="sans-serif" fill="#111114">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
