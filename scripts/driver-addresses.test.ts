// Extra addresses on a driver profile, and the out-of-state license rule.
// Fixtures use example streets only — never real renters.
import { describe, expect, test } from "bun:test";
import {
  APPLICATION_ADDRESS_LABEL,
  LICENSE_ADDRESS_LABEL,
  addressFromApplication,
  formatAddress,
  isOutOfStateLicense,
  licenseIssuingState,
  normalizeAddress,
  normalizeUsState,
  normalizeZip,
  planLicenseAddressSave,
  sameAddress,
} from "@/lib/driver-addresses";
import { assessForFleet } from "@/lib/fleet-review";

const NOW = new Date("2026-11-16T15:00:00Z");
const A = "11111111-1111-4111-8111-111111111111";

const appAddr = { line1: "100 Example Rd", city: "Plant City", state: "FL", zip: "33567" };
const licenseAddr = { line1: null, city: "Exampleville", state: "FL", zip: "34448" };

function existing(partial: Record<string, any> = {}) {
  return {
    id: partial.id ?? "addr-1",
    source: partial.source ?? "application",
    label: partial.label ?? APPLICATION_ADDRESS_LABEL,
    line1: "line1" in partial ? partial.line1 : appAddr.line1,
    line2: "line2" in partial ? partial.line2 : null,
    city: "city" in partial ? partial.city : appAddr.city,
    state: "state" in partial ? partial.state : appAddr.state,
    zip: "zip" in partial ? partial.zip : appAddr.zip,
  };
}

describe("normalize and compare", () => {
  test("state names and codes become a two-letter US code", () => {
    expect(normalizeUsState("fl")).toBe("FL");
    expect(normalizeUsState("Florida")).toBe("FL");
    expect(normalizeUsState("GA")).toBe("GA");
    expect(normalizeUsState("xx")).toBeNull();
    expect(normalizeUsState("")).toBeNull();
  });
  test("zips keep five digits or ZIP+4", () => {
    expect(normalizeZip("33567")).toBe("33567");
    expect(normalizeZip("33567-1234")).toBe("33567-1234");
    expect(normalizeZip("335671234")).toBe("33567-1234");
    expect(normalizeZip("123")).toBeNull();
  });
  test("sameAddress ignores case, extra spaces, and punctuation", () => {
    expect(sameAddress(appAddr, { line1: "100 example rd.", city: "plant city", state: "Florida", zip: "33567" })).toBe(true);
    expect(sameAddress(appAddr, licenseAddr)).toBe(false);
    expect(addressFromApplication({ address: "100 Example Rd", city: "Plant City", state: "FL", zip: "33567" })).toEqual(normalizeAddress(appAddr));
  });
  test("formatAddress joins the parts", () => {
    expect(formatAddress(appAddr)).toBe("100 Example Rd, Plant City, FL 33567");
    expect(formatAddress(licenseAddr)).toBe("Exampleville, FL 34448");
    expect(formatAddress(null)).toBe("—");
  });
});

describe("planLicenseAddressSave", () => {
  test("saves a different license address as a second License address row", () => {
    const plan = planLicenseAddressSave({ primary: appAddr, reading: licenseAddr, existing: [existing()] });
    expect(plan).toEqual({
      action: "insert",
      row: { ...normalizeAddress(licenseAddr), label: LICENSE_ADDRESS_LABEL, source: "license_reading", is_primary: false },
    });
    expect(plan.action === "insert" && plan.row.is_primary).toBe(false);
  });
  test("does not overwrite the primary when the reading matches it", () => {
    const plan = planLicenseAddressSave({ primary: appAddr, reading: appAddr, existing: [existing()] });
    expect(plan).toEqual({ action: "skip", reason: "same_as_primary" });
  });
  test("does not overwrite a staff-entered row with the same address", () => {
    const staff = existing({ source: "staff", label: "Work", line1: licenseAddr.line1, city: licenseAddr.city, state: licenseAddr.state, zip: licenseAddr.zip });
    const plan = planLicenseAddressSave({ primary: appAddr, reading: licenseAddr, existing: [existing(), staff] });
    expect(plan).toEqual({ action: "skip", reason: "staff_row_protected" });
  });
  test("does not overwrite a staff-edited License address row", () => {
    const staff = existing({ source: "staff", label: LICENSE_ADDRESS_LABEL, line1: "9 Staff St", city: "Tampa", state: "FL", zip: "33602" });
    const plan = planLicenseAddressSave({ primary: appAddr, reading: licenseAddr, existing: [existing(), staff] });
    expect(plan).toEqual({ action: "skip", reason: "staff_row_protected" });
  });
  test("updates an automatic License address row when the reading changes", () => {
    const auto = existing({ id: "lic-row", source: "license_reading", label: LICENSE_ADDRESS_LABEL, line1: "Old", city: "Old City", state: "FL", zip: "30000" });
    const plan = planLicenseAddressSave({ primary: appAddr, reading: licenseAddr, existing: [existing(), auto] });
    expect(plan).toEqual({ action: "update", id: "lic-row", patch: normalizeAddress(licenseAddr) });
  });
  test("skips an empty reading", () => {
    expect(planLicenseAddressSave({ primary: appAddr, reading: null, existing: [] })).toEqual({ action: "skip", reason: "empty" });
  });
});

describe("license issuing state", () => {
  test("prefers a staff/application entry, then a reading, then screening", () => {
    expect(licenseIssuingState({ license_state: "FL" }, { license_state: "GA" }, { license_state: "TN" })).toBe("FL");
    expect(licenseIssuingState({ license_state: null }, { license_state: "ga" }, null)).toBe("GA");
    expect(licenseIssuingState({}, {}, { license_state: "Tennessee" })).toBe("TN");
    expect(licenseIssuingState({}, {}, {})).toBeNull();
  });
  test("only a non-Florida issuing state is out of state", () => {
    expect(isOutOfStateLicense("FL")).toBe(false);
    expect(isOutOfStateLicense("GA")).toBe(true);
    expect(isOutOfStateLicense(null)).toBe(false);
  });
});

describe("assessForFleet address rules (t359u)", () => {
  const base = { screening: null, docs: [] as any[], disqualifiers: [], readinessState: "promising_more_info", openNeedsStaff: null, priorDeclined: 0, now: NOW };
  const good = {
    id: A, full_name: "Test Renter", email: "t@example.com", phone: "5550100000", status: "new",
    dob: "1980-02-26", license_expiration: "2030-02-26", license_valid: true, license_state: "FL",
    rating: 4.5, trips_completed: 100, gig_status: "Yes, already driving",
    background_check_status: "pending", mvr_status: "pending", deleted_at: null,
    address: "100 Example Rd", city: "Plant City", state: "FL", zip: "33567",
  };
  const docs = [
    { category: "license_front", review_status: "uploaded", is_current: true },
    { category: "gig_profile", review_status: "uploaded", is_current: true },
  ];

  test("a Florida license with a different address is not escalated", () => {
    const a = assessForFleet({
      ...base, docs, app: good,
      licenseReading: { license_state: "FL", address_line1: null, address_city: "Exampleville", address_state: "FL", address_zip: "34448" },
    });
    const codes = a.escalations.map((e) => e.code);
    expect(codes).not.toContain("address_mismatch");
    expect(codes).not.toContain("out_of_state_license");
    expect(a.notes.map((n) => n.code)).toContain("license_address_recorded");
    expect(a.recommendation).toBe("approve");
  });

  test("an out-of-state license escalates to staff", () => {
    const a = assessForFleet({
      ...base, docs, app: { ...good, license_state: "GA" },
      licenseReading: { license_state: "GA", address_city: "Atlanta", address_state: "GA", address_zip: "30301" },
    });
    expect(a.escalations.map((e) => e.code)).toContain("out_of_state_license");
    expect(a.escalations.map((e) => e.code)).not.toContain("address_mismatch");
    expect(a.recommendation).toBe("needs_staff");
  });

  test("a staff-entered out-of-state license escalates even without a reading", () => {
    const a = assessForFleet({ ...base, docs, app: { ...good, license_state: "TN" } });
    expect(a.escalations.some((e) => e.code === "out_of_state_license" && e.message.includes("TN"))).toBe(true);
    expect(a.recommendation).toBe("needs_staff");
  });
});
