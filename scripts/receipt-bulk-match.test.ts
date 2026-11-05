import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkBulkFile, filenameText, guessReceiptKind, matchFileToVehicles, receiptStoragePath } from "../src/lib/receipt-bulk-match";

const V = [
  { id: "a", vin: "1HGCM82633A004352", license_plate: "ABC1234", unit_number: "12" },
  { id: "b", vin: "2T1BURHE5JC004352", license_plate: "XYZ9876", unit_number: "7" },
  { id: "c", vin: "3FA6P0H74HR123456", license_plate: "RR-5555", unit_number: "21" },
  { id: "d", vin: null, license_plate: "QQ12", unit_number: null },
];

describe("matcher", () => {
  test("full VIN", () => expect(matchFileToVehicles("Invoice VIN: 1HGCM82633A004352", V)).toEqual({ kind: "auto", vehicleId: "a", basis: "vin" }));
  test("VIN suffix unique", () => expect(matchFileToVehicles("vin ending in 123456", V)).toEqual({ kind: "auto", vehicleId: "c", basis: "vin_suffix" }));
  test("VIN suffix ambiguous", () => {
    const m = matchFileToVehicles("VIN 004352 oil change", V);
    expect(m.kind).toBe("ambiguous");
    if (m.kind === "ambiguous") expect(m.candidates.sort()).toEqual(["a", "b"]);
  });
  test("plate in filename", () => expect(matchFileToVehicles(filenameText("jiffy_lube_XYZ9876_2026-10-01.pdf"), V)).toEqual({ kind: "auto", vehicleId: "b", basis: "plate" }));
  test("spaced/dashed plate", () => expect(matchFileToVehicles("Plate: RR 5555", V)).toEqual({ kind: "auto", vehicleId: "c", basis: "plate" }));
  test("short plates ignored", () => expect(matchFileToVehicles("QQ12", V).kind).toBe("unmatched"));
  test("unit number", () => expect(matchFileToVehicles("Car #21 tire rotation", V)).toEqual({ kind: "auto", vehicleId: "c", basis: "unit" }));
  test("unit 7 not confused with 21/12", () => expect(matchFileToVehicles("unit 7", V)).toEqual({ kind: "auto", vehicleId: "b", basis: "unit" }));
  test("two plates -> ambiguous", () => expect(matchFileToVehicles("ABC1234 and XYZ9876", V).kind).toBe("ambiguous"));
  test("VIN outranks plate", () => expect(matchFileToVehicles("XYZ9876 1HGCM82633A004352", V)).toEqual({ kind: "auto", vehicleId: "a", basis: "vin" }));
  test("nothing", () => expect(matchFileToVehicles("Car wash 10/01", V)).toEqual({ kind: "unmatched" }));
  test("bare numbers are not units", () => expect(matchFileToVehicles("Total 12.00", V).kind).toBe("unmatched"));
});

describe("helpers", () => {
  test("kind", () => {
    expect(guessReceiptKind("INVOICE #443")).toBe("invoice");
    expect(guessReceiptKind("inv-2201 shop")).toBe("invoice");
    expect(guessReceiptKind("receipt")).toBe("receipt");
  });
  test("path shape matches server regex", () => {
    const p = receiptStoragePath("0f8b2c1e-1111-2222-3333-444455556666", "Scan.PDF", "abc123", 1700000000000);
    expect(p).toBe("0f8b2c1e-1111-2222-3333-444455556666/1700000000000-abc123.pdf");
    const src = readFileSync("src/lib/receipt-bulk.functions.ts", "utf8");
    const re = new RegExp(/regex\(\/(.+?)\/\)/.exec(src)![1]);
    expect(re.test(p)).toBe(true);
    expect(re.test("../etc/1-a.pdf")).toBe(false);
  });
  test("file checks", () => {
    expect(checkBulkFile({ name: "a.pdf", size: 10, type: "application/pdf" })).toBeNull();
    expect(checkBulkFile({ name: "a.exe", size: 10, type: "application/x-msdownload" })).not.toBeNull();
    expect(checkBulkFile({ name: "a.jpg", size: 30 * 1024 * 1024, type: "image/jpeg" })).not.toBeNull();
  });
});

describe("server fn", () => {
  const src = readFileSync("src/lib/receipt-bulk.functions.ts", "utf8");
  test("manager only, team-only row, links per car", () => {
    expect(src).toMatch(/requireManager\(context\.userId\)/);
    expect(src).toMatch(/visibility: \["admin"\]/);
    expect(src).toMatch(/driver_id: null/);
    expect(src).toMatch(/document_vehicle_links/);
  });
  test("renter portal receipts unchanged (payments, 1 year after return)", () => {
    const sql = readFileSync("supabase/migrations/20261104210000_renter_portal.sql", "utf8");
    expect(sql).toMatch(/FROM public\.payments p/);
    expect(sql).not.toMatch(/vehicle_receipt|vehicle_invoice/);
  });
});
