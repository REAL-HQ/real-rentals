import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  checkPaperPdf, sha256Hex, paperStoragePath, safeFileName, PAPER_MAX_BYTES,
  encodeSignedOn, decodeSignedOn, validSignedOn,
} from "../src/lib/paper-agreements";

const enc = (s: string) => new TextEncoder().encode(s);
const pdf = enc("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const src = readFileSync("src/lib/paper-agreements.functions.ts", "utf8");

describe("Paper agreement validation", () => {
  it("accepts a complete PDF", () => expect(checkPaperPdf(pdf).ok).toBe(true));
  it("rejects non-PDF bytes even if named .pdf", () => expect(checkPaperPdf(enc("hello %%EOF")).ok).toBe(false));
  it("rejects a truncated PDF", () => expect(checkPaperPdf(enc("%PDF-1.4 partial")).ok).toBe(false));
  it("rejects empty files", () => expect(checkPaperPdf(new Uint8Array()).ok).toBe(false));
  it("rejects files over 20 MB", () => {
    const big = new Uint8Array(PAPER_MAX_BYTES + 1); big.set(pdf);
    expect(checkPaperPdf(big).ok).toBe(false);
  });
});

describe("Integrity and storage", () => {
  it("SHA-256 matches a known vector", async () =>
    expect(await sha256Hex(enc("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
  it("paths are unique per id and scoped to the driver", () => {
    expect(paperStoragePath("app", "a")).not.toBe(paperStoragePath("app", "b"));
    expect(paperStoragePath("app", "a")).toBe("paper/app/a.pdf");
  });
  it("sanitizes file names", () => expect(safeFileName("../x<y>")).toBe(".._x_y_.pdf"));
  it("round-trips signed date", () => expect(decodeSignedOn(encodeSignedOn("2026-10-15"))).toBe("2026-10-15"));
  it("refuses future signed dates", () => expect(validSignedOn("2026-12-01", "2026-10-17")).toBe(false));
});

describe("Server boundaries", () => {
  it("upload authorizes Owner/Manager before the release hold", () =>
    expect(src.indexOf("requireManager(context.userId); // Owner/Manager")).toBeLessThan(src.indexOf("if (!LIVE_RENTAL_RELEASE.paperAgreements)")));
  it("never overwrites, never writes agreements/rentals, never issues signed URLs", () => {
    expect(src).toContain("upsert: false");
    expect(src).not.toMatch(/from\("agreements"\)|from\("rentals"\)|createSignedUrl|createSignedUploadUrl/);
    expect(src).not.toMatch(/sendEmail|sendSms/);
  });
  it("refuses duplicates and cleans up failed uploads", () => {
    expect(src).toContain("already on file");
    expect(src.match(/\.remove\(\[path\]\)/g)?.length).toBe(2);
  });
  it("records paper provenance", () => expect(src).toMatch(/source: "paper"/));
});
