import { describe, expect, test } from "bun:test";
import {
  VEHICLE_SHARE_TTL_MS,
  VEHICLE_SHARE_TOKEN_RE,
  automaticEnhancedPhotoIds,
  automaticInsurancePhotoIds,
  buildInsuranceDetails,
  formatVehicleShareSmsBody,
  isShareMediaEligible,
  isVehicleShareActive,
  maskShareRecipient,
  readStoredVehicleSharePackage,
  vehicleShareStorageKey,
  type VehicleShareMedia,
} from "../src/lib/vehicle-share";
import { hashVehicleShareToken, newVehicleShareToken, vehicleShareUrl } from "../src/lib/vehicle-share.server";

const photo = (id: string, values: Partial<VehicleShareMedia> = {}): VehicleShareMedia => ({
  id, vehicle_id: "00000000-0000-4000-8000-000000000001", kind: "original",
  storage_bucket: "vehicle-photos", storage_path: `${id}.jpg`, file_name: `${id}.jpg`, mime_type: "image/jpeg",
  published: false, is_primary: false, sort_order: 0, created_at: "2026-11-08T00:00:00.000Z", ...values,
});

describe("vehicle insurance photo package", () => {
  test("the first package includes only approved AI enhancements, with the lead enhancement first", () => {
    const ids = automaticEnhancedPhotoIds([
      photo("00000000-0000-4000-8000-00000000000a", { kind: "ai_enhanced", review_status: "approved", sort_order: 2 }),
      photo("00000000-0000-4000-8000-00000000000b", { kind: "ai_enhanced", review_status: "approved", is_primary: true, sort_order: 9 }),
      photo("00000000-0000-4000-8000-00000000000c", { kind: "ai_enhanced", review_status: "pending" }),
      photo("00000000-0000-4000-8000-00000000000d", { kind: "marketing", studio_review_status: "approved" }),
      photo("00000000-0000-4000-8000-00000000000e", { published: true }),
    ]);
    expect(ids).toEqual(["00000000-0000-4000-8000-00000000000b", "00000000-0000-4000-8000-00000000000a"]);
  });

  test("best photos are the published lead and listing order, never unapproved or private fallbacks", () => {
    const ids = automaticInsurancePhotoIds([
      photo("00000000-0000-4000-8000-00000000000a", { sort_order: 2, published: true }),
      photo("00000000-0000-4000-8000-00000000000b", { sort_order: 1, published: true, is_primary: true }),
      photo("00000000-0000-4000-8000-00000000000c", { sort_order: 0 }),
      photo("00000000-0000-4000-8000-00000000000d", { kind: "ai_enhanced", published: true, review_status: "pending" }),
      photo("00000000-0000-4000-8000-00000000000e", { kind: "ai_enhanced", published: true, review_status: "approved", sort_order: 3 }),
    ]);
    expect(ids).toEqual([
      "00000000-0000-4000-8000-00000000000b",
      "00000000-0000-4000-8000-00000000000a",
      "00000000-0000-4000-8000-00000000000e",
    ]);
  });

  test("manual selection allows any original and approved retouch, but rejects pending derivatives and non-images", () => {
    expect(isShareMediaEligible(photo("00000000-0000-4000-8000-00000000000a"))).toBe(true);
    expect(isShareMediaEligible(photo("00000000-0000-4000-8000-00000000000a", { kind: "ai_enhanced", review_status: "approved" }))).toBe(true);
    expect(isShareMediaEligible(photo("00000000-0000-4000-8000-00000000000a", { kind: "ai_enhanced", review_status: "pending" }))).toBe(false);
    expect(isShareMediaEligible(photo("00000000-0000-4000-8000-00000000000a", { mime_type: "application/pdf" }))).toBe(false);
  });

  test("insurance details contain real VIN and registration fields, not rates, policy numbers or finance", () => {
    const details = buildInsuranceDetails({
      unit_number: "RR-001", year: 2026, make: "Toyota", model: "Camry", vin: "1HGCM82633A004352",
      license_plate: "ABC123", plate_state: "FL", registration_number: "REG-9", registration_expires_on: "2026-10-11",
      insurance_policy_number: "DO-NOT-SHARE", weekly_rate: 350, payoff: 40000,
    });
    const flat = JSON.stringify(details);
    expect(flat).toContain("1HGCM82633A004352");
    expect(flat).toContain("ABC123");
    expect(flat).toContain("REG-9");
    expect(flat).toContain("Oct 11, 2026");
    expect(flat).not.toContain("DO-NOT-SHARE");
    expect(flat).not.toContain("40000");
    expect(flat).not.toContain("350");
  });
});

describe("private share token and stored package", () => {
  test("raw tokens are high entropy hex (SMS-safe) and only their SHA-256 hash is used for storage", async () => {
    const first = await newVehicleShareToken();
    const second = await newVehicleShareToken();
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    expect(first.token).not.toMatch(/[_-]/); // Quo/iOS truncate share URLs at "_"
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenHash).not.toBe(first.token);
    expect(await hashVehicleShareToken(first.token)).toBe(first.tokenHash);
    expect(vehicleShareStorageKey(first.tokenHash)).toBe(`vehicle_share_package:${first.tokenHash}`);
    expect(VEHICLE_SHARE_TOKEN_RE.test(first.token)).toBe(true);
    // Legacy base64url tokens from older packages still open.
    expect(VEHICLE_SHARE_TOKEN_RE.test("r8fQ_GHWJ-SB_sPyTD7qcmsEOFII65UHswcMU0UMUhU")).toBe(true);
    expect(VEHICLE_SHARE_TOKEN_RE.test("r8fQ_")).toBe(false);
  });

  test("recipient links always use the public site, never a staff-only preview or unknown host", async () => {
    const { token } = await newVehicleShareToken();
    const publicUrl = `https://drivereal.com/share/vehicle/${token}`;
    expect(vehicleShareUrl("https://drivereal.com", token)).toBe(publicUrl);
    expect(vehicleShareUrl("http://localhost:8080", token)).toBe(publicUrl);
    expect(vehicleShareUrl("http://127.0.0.1:8080", token)).toBe(publicUrl);
    expect(vehicleShareUrl("https://id-preview--example.lovable.app", token)).toBe(publicUrl);
    expect(vehicleShareUrl("https://attacker.example", token)).toBe(publicUrl);
  });

  test("expired and revoked packages fail closed", () => {
    const future = new Date(Date.now() + VEHICLE_SHARE_TTL_MS).toISOString();
    expect(isVehicleShareActive({ expiresAt: future, revokedAt: null })).toBe(true);
    expect(isVehicleShareActive({ expiresAt: "2026-01-01T00:00:00.000Z", revokedAt: null })).toBe(false);
    expect(isVehicleShareActive({ expiresAt: future, revokedAt: "2026-11-08T00:00:00.000Z" })).toBe(false);
    expect(readStoredVehicleSharePackage({ vehicleId: "v", mediaIds: [] })).toBeNull();
  });

  test("SMS body keeps the full URL alone on its own line", () => {
    const url = "https://drivereal.com/share/vehicle/" + "a".repeat(64);
    const body = formatVehicleShareSmsBody({
      title: "2015 Ford Fusion",
      includeDetails: false,
      message: "Hi Heather! Pickup tomorrow.\nEmail: rosa@drivereal.com",
      url,
      expiresLabel: "Nov 12, 2026",
    });
    expect(body).toContain("REAL RENTALS: 2015 Ford Fusion photos");
    expect(body).toContain("Hi Heather! Pickup tomorrow.");
    expect(body).toContain("Private link expires Nov 12, 2026:");
    expect(body).toContain("\n\n" + url + "\n\n");
    expect(body.indexOf(url)).toBeGreaterThan(body.indexOf("Private link expires"));
    // URL must not be jammed onto the Email: signature line.
    expect(body).not.toMatch(/Email:[^\n]*share\/vehicle/);
    expect(body.endsWith("Reply STOP to opt out.")).toBe(true);
  });

  test("audit metadata masks the recipient", () => {
    expect(maskShareRecipient("email", "renter@example.com")).toBe("r•••@example.com");
    expect(maskShareRecipient("sms", "+1 (555) 555-1234")).toBe("•••1234");
  });
});
