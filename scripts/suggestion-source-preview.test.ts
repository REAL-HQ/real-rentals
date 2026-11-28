/**
 * Source-file thumbnails on Details Found In Documents.
 * Signed URLs are cached per path, limited to the private vehicle-docs bucket,
 * and never minted with a service role. The dialog still opens a photograph
 * through the staff storage download.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vehicleDocSource, sourcePageNumber } from "../src/lib/suggestion-source-file";
import { loadStaffVehicleDocUrl, resetStaffVehicleDocUrlCache } from "../src/lib/vehicle-doc-url";
import { SourceDocThumb } from "../src/components/admin/SourceDocThumb";

beforeEach(() => resetStaffVehicleDocUrlCache());

describe("vehicle document paths", () => {
  test("paperwork paths are returned and URLs are not", () => {
    expect(vehicleDocSource({
      storage_bucket: "vehicle-docs",
      storage_path: "veh/title-8.jpg",
      mime_type: "image/jpeg",
    })).toEqual({
      storageBucket: "vehicle-docs",
      storagePath: "veh/title-8.jpg",
      mimeType: "image/jpeg",
    });
    expect(vehicleDocSource({
      storage_bucket: "vehicle-photos",
      storage_path: "veh/front.jpg",
      mime_type: "image/jpeg",
    }).storagePath).toBeNull();
    expect(vehicleDocSource({
      storage_bucket: "vehicle-docs",
      storage_path: "https://files.example/title.jpg",
      mime_type: "image/jpeg",
    }).storagePath).toBeNull();
    expect(vehicleDocSource({
      storage_bucket: "vehicle-docs",
      storage_path: "../secret.jpg",
      mime_type: null,
    }).storagePath).toBeNull();
    expect(vehicleDocSource(null)).toEqual({ storageBucket: null, storagePath: null, mimeType: null });
  });

  test("a missing page still means the first page", () => {
    expect(sourcePageNumber(null)).toBe(1);
    expect(sourcePageNumber(0)).toBe(1);
    expect(sourcePageNumber(3.9)).toBe(3);
  });
});

describe("signed URL cache", () => {
  test("rows that share a file share one signature", async () => {
    let calls = 0;
    const signer = async (bucket: string, path: string) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return `https://example.test/${bucket}/${path}?token=1`;
    };
    const [a, b] = await Promise.all([
      loadStaffVehicleDocUrl("vehicle-docs", "veh/title-8.jpg", signer),
      loadStaffVehicleDocUrl("vehicle-docs", "veh/title-8.jpg", signer),
    ]);
    expect(a).toBe("https://example.test/vehicle-docs/veh/title-8.jpg?token=1");
    expect(b).toBe(a);
    expect(calls).toBe(1);
    await loadStaffVehicleDocUrl("vehicle-docs", "veh/title-8.jpg", signer);
    expect(calls).toBe(1);
    await loadStaffVehicleDocUrl("vehicle-docs", "veh/other.jpg", signer);
    expect(calls).toBe(2);
  });

  test("a failed signature is not remembered, and other buckets are refused", async () => {
    let calls = 0;
    const signer = async () => {
      calls += 1;
      return null;
    };
    expect(await loadStaffVehicleDocUrl("vehicle-docs", "veh/title-8.jpg", signer)).toBeNull();
    expect(await loadStaffVehicleDocUrl("vehicle-docs", "veh/title-8.jpg", signer)).toBeNull();
    expect(calls).toBe(2);
    expect(await loadStaffVehicleDocUrl("vehicle-photos", "veh/front.jpg", signer)).toBeNull();
    expect(await loadStaffVehicleDocUrl("vehicle-docs", "https://evil.test/a.jpg", signer)).toBeNull();
    expect(calls).toBe(2);
  });

  test("a thrown signature becomes a miss", async () => {
    expect(await loadStaffVehicleDocUrl("vehicle-docs", "veh/title-8.jpg", async () => {
      throw new Error("denied");
    })).toBeNull();
  });
});

describe("thumbnail markup", () => {
  test("a resolved image is a 64px cover thumbnail", () => {
    const html = renderToStaticMarkup(h(SourceDocThumb, {
      fileName: "title-8.jpg",
      mimeType: "image/jpeg",
      page: 1,
      storageBucket: "vehicle-docs",
      storagePath: "veh/title-8.jpg",
      presetUrl: "/fixtures/title-8.jpg",
      onOpen() {},
    }));
    expect(html).toContain("h-16");
    expect(html).toContain("w-16");
    expect(html).toContain("rounded-lg");
    expect(html).toContain("object-cover");
    expect(html).toContain("border");
    expect(html).toContain("/fixtures/title-8.jpg");
    expect(html).toContain("View Source Document: title-8.jpg");
  });

  test("a document that is still signing shows a skeleton", () => {
    const html = renderToStaticMarkup(h(SourceDocThumb, {
      fileName: "title-8.jpg",
      mimeType: "image/jpeg",
      storageBucket: "vehicle-docs",
      storagePath: "veh/title-8.jpg",
      onOpen() {},
    }));
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("<img");
  });

  test("a file the browser cannot preview is a file icon", () => {
    const html = renderToStaticMarkup(h(SourceDocThumb, {
      fileName: "notes.zip",
      mimeType: "application/zip",
      storageBucket: "vehicle-docs",
      storagePath: "veh/notes.zip",
      onOpen() {},
    }));
    expect(html).not.toContain("animate-pulse");
    expect(html).toContain("<svg");
  });
});

describe("the review dialog wiring", () => {
  const panel = readFileSync("src/components/admin/VehicleSuggestions.tsx", "utf8");
  const inbox = readFileSync("src/lib/fleet-inbox.functions.ts", "utf8");
  const signer = readFileSync("src/lib/vehicle-doc-url.ts", "utf8");

  test("photographs still use the staff download, paperwork uses a session signature", () => {
    expect(panel).toContain("loadStaffPhoto(path)");
    expect(panel).toContain("{s.photoPath && <EvidencePhoto");
    expect(panel).toContain("onOpen={setViewing}");
    expect(panel).toContain("src={viewing}");
    expect(panel).toContain("max-h-[90vh] max-w-full object-contain");
    expect(panel).toContain("loadStaffVehicleDocUrl");
    expect(panel).not.toContain("supabaseAdmin");
    expect(panel).not.toContain("service_role");
    expect(inbox).toContain("vehicleDocSource(doc)");
    expect(inbox).not.toContain("createSignedUrl");
    expect(signer).toContain("createSignedUrl");
    expect(signer).toContain('from(bucket)');
    expect(signer).not.toContain("supabaseAdmin");
    expect(signer).not.toContain("service_role");
  });

  test("the lightbox names the file and can be closed", () => {
    expect(panel).toContain('aria-label="Zoom In"');
    expect(panel).toContain('aria-label="Zoom Out"');
    expect(panel).toContain('aria-label="Close"');
    expect(panel).toContain('e.key === "Escape"');
    expect(panel).toContain("suggestion-source-lightbox");
    expect(panel).toContain("data-testid=\"suggestion-source-file\"");
  });
});
