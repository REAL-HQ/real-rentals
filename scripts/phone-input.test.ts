/**
 * t369u / t370u: one shared formatted phone field everywhere, and a
 * normal-size checkbox. Only 555 numbers here — never a real renter number.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applicantPhoneForSubmit,
  applicantPhoneLookupValues,
  caretAfterFormat,
  formatPhoneForDisplay,
  formatPhoneInput,
  formatUsPhoneInput,
  usPhoneE164,
} from "../src/lib/us-phone";
import { normalizeDriverPhone, samePhone } from "../src/lib/driver-contacts";
import { businessPhoneE164 } from "../src/lib/company";

const E164 = "+18135550123";
const PRETTY = "(813) 555-0123";

describe("formatPhoneInput (shared field, any mode)", () => {
  test("pastes and autofill in every common shape become (813) 555-0123", () => {
    for (const raw of [
      "8135550123",
      "18135550123", // Chrome / password-manager autofill
      "+18135550123",
      "+1 813 555 0123",
      "+1 (813) 555-0123",
      "1-813-555-0123",
      "813-555-0123",
      "813.555.0123",
      "813 555 0123",
      " (813)555-0123 ",
    ]) {
      expect(formatPhoneInput(raw)).toBe(PRETTY);
      expect(formatUsPhoneInput(raw)).toBe(PRETTY);
    }
  });

  test("formats progressively while typing", () => {
    expect(formatPhoneInput("")).toBe("");
    expect(formatPhoneInput("8")).toBe("(8");
    expect(formatPhoneInput("8135")).toBe("(813) 5");
    expect(formatPhoneInput("8135550")).toBe("(813) 555-0");
  });

  test("leaves international numbers and extensions as typed", () => {
    expect(formatPhoneInput("+44 20 5550 0123")).toBe("+44 20 5550 0123");
    expect(formatPhoneInput("813-555-0123 ext 4")).toBe("813-555-0123 ext 4");
    expect(formatPhoneInput("813-555-0123 x4")).toBe("813-555-0123 x4");
  });

  test("is idempotent", () => {
    expect(formatPhoneInput(formatPhoneInput("18135550123"))).toBe(PRETTY);
  });
});

describe("formatPhoneForDisplay (what an existing stored value shows as)", () => {
  test("E.164 and other stored US shapes show formatted", () => {
    expect(formatPhoneForDisplay(E164)).toBe(PRETTY);
    expect(formatPhoneForDisplay("813-555-0123")).toBe(PRETTY);
    expect(formatPhoneForDisplay(PRETTY)).toBe(PRETTY);
  });
  test("empty, partial, international, and extension values are untouched", () => {
    expect(formatPhoneForDisplay(null)).toBe("");
    expect(formatPhoneForDisplay("")).toBe("");
    expect(formatPhoneForDisplay("555012")).toBe("555012");
    expect(formatPhoneForDisplay("+44 20 5550 0123")).toBe("+44 20 5550 0123");
    expect(formatPhoneForDisplay("813-555-0123 x4")).toBe("813-555-0123 x4");
  });
});

describe("caretAfterFormat", () => {
  test("caret at the end stays at the end", () => {
    expect(caretAfterFormat("8135", 4, "(813) 5")).toBe(7);
    expect(caretAfterFormat("8135550123", 10, PRETTY)).toBe(PRETTY.length);
  });
  test("an edit in the middle keeps the caret after the same digit", () => {
    // User typed "5" after "(813) 5" in "(813) 550123" -> "(813) 5550123"
    const typed = "(813) 5550123";
    const next = formatPhoneInput(typed);
    expect(next).toBe(PRETTY);
    expect(next.slice(0, caretAfterFormat(typed, 8, next))).toBe("(813) 55");
  });
  test("a stripped country-code 1 does not shift the caret", () => {
    const typed = "18135550123";
    expect(caretAfterFormat(typed, 4, PRETTY)).toBe(PRETTY.indexOf(")"));
  });
});

describe("stored values are unchanged (E.164 where the backend expects it)", () => {
  test("formatted text normalizes to the same E.164 everywhere", () => {
    for (const shown of [PRETTY, formatPhoneInput("18135550123")]) {
      expect(applicantPhoneForSubmit(shown)).toBe(E164);
      expect(usPhoneE164(shown)).toBe(E164);
      expect(normalizeDriverPhone(shown)).toBe(E164);
      expect(businessPhoneE164(shown)).toBe(E164);
    }
  });
  test("duplicate matching still treats the formatted and stored forms as one", () => {
    expect(samePhone(PRETTY, E164)).toBe(true);
    expect(applicantPhoneLookupValues(PRETTY)).toContain(E164);
    expect(applicantPhoneLookupValues(PRETTY)).toContain(PRETTY);
  });
});

describe("wiring: one shared PhoneInput for every phone field", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const files: Record<string, RegExp> = {
    "src/routes/apply.tsx": /<PhoneInput\s+mode="us"/,
    "src/components/site/CityHeroLeadForm.tsx": /<PhoneInput mode="us"/,
    "src/components/site/LocationsSection.tsx": /<PhoneInput mode="us"/,
    "src/routes/contact.tsx": /<PhoneInput mode="us"/,
    "src/routes/partners.tsx": /<PhoneInput mode="us"/,
    "src/routes/portal.tsx": /<PhoneInput\s+value=\{f\.phone\}/,
    "src/components/portal/ApplicantHome.tsx": /<PhoneInput mode="us"/,
    "src/components/admin/DriverContactsEditor.tsx":
      /<PhoneInput[\s\S]{0,80}value=\{editValue\}[\s\S]*<PhoneInput[\s\S]{0,80}value=\{draftValue\}/,
    "src/components/admin/SettingsPanel.tsx": /f\.type === "tel" \? \([\s\S]{0,200}<PhoneInput/,
    "src/components/admin/VendorsPanel.tsx": /<Txt label="Phone" phone /,
    "src/components/admin/ShopsPanel.tsx": /<PhoneInput value=\{phone\}/,
    "src/components/admin/PartnersPanel.tsx": /<PhoneInput placeholder="Phone"/,
    "src/components/admin/RenterVendorsPanel.tsx": /k === "phone" \? \(\s*<PhoneInput/,
    "src/components/admin/VehicleProfile.tsx":
      /label="Phone"\s+phone\s+value=\{str\("insurance_agent_phone"\)\}/,
    "src/components/admin/VehicleEditorDrawer.tsx":
      /label="Phone"\s+phone\s+value=\{str\("insurance_agent_phone"\)\}/,
    "src/components/admin/VehicleProfileFields.tsx": /phone \? \(\s*<PhoneInput/,
    "src/components/admin/DriverScreening.tsx": /<PhoneInput\s+value=\{s\.insurance_carrier_phone/,
    "src/components/admin/VehicleShareSendPanel.tsx": /<PhoneInput id="vehicle-share-recipient"/,
    "src/components/admin/PrepareAgreementDialog.tsx": /<label>Phone<PhoneInput /,
  };
  for (const [file, re] of Object.entries(files)) {
    test(file, () => {
      const src = read(file);
      expect(src).toMatch(re);
      // The vehicle screens use the shared Text field's phone mode.
      if (!/Vehicle(Profile|EditorDrawer)\.tsx$/.test(file)) {
        expect(src).toMatch(/from "@\/components\/ui\/phone-input"/);
      }
    });
  }

  test("settings phone keys are tel fields", () => {
    const s = read("src/components/admin/SettingsPanel.tsx");
    expect(s).toMatch(/key: "business_phone", label: "Business Phone", type: "tel"/);
    expect(s).toMatch(/key: "sms_number", label: "Admin SMS Number", type: "tel"/);
  });

  test("writes that land in applications.phone / waitlist.phone stay E.164", () => {
    expect(read("src/lib/portal.functions.ts")).toMatch(
      /out\.phone = \(usPhoneE164\(phone\) \?\? phone\)\.slice\(0, 40\)/,
    );
    expect(read("src/lib/agreement-fills.ts")).toMatch(
      /put\("phone", usPhoneE164\(phone\) \?\? phone\)/,
    );
    expect(read("src/components/site/LocationsSection.tsx")).toMatch(
      /applicantPhoneForSubmit\(phone\)/,
    );
    expect(read("src/components/admin/DriverContactsEditor.tsx")).toMatch(
      /normalizeDriverContact\(c\.kind, editValue\)/,
    );
    expect(read("src/components/admin/DriverContactsEditor.tsx")).toMatch(
      /normalizeDriverContact\(kind, draftValue\)/,
    );
  });

  test("no raw tel inputs remain outside the shared component", () => {
    const { execSync } = require("node:child_process");
    const files = execSync(`grep -rl 'tel' src --include=*.tsx || true`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    const raw = files.filter(
      (f: string) =>
        f !== "src/components/ui/phone-input.tsx" &&
        /<input\b[^>]*type=\{?["']tel["']/.test(read(f)),
    );
    expect(raw).toEqual([]);
  });

  test("the normal-size checkbox is used where the oversized style could appear", () => {
    for (const f of [
      "src/components/site/SmsConsentField.tsx",
      "src/components/site/ApplicationWizard.tsx",
      "src/components/esign/SigningPanel.tsx",
      "src/components/site/FleetFiltersBar.tsx",
    ]) {
      const src = read(f);
      expect(src).toMatch(/<CheckboxInput\b/);
      expect(src).not.toMatch(/\bh-11 w-11\b/);
    }
  });

  test("no real phone numbers in this test (555 only)", () => {
    const me = read("scripts/phone-input.test.ts");
    const numbers = me.match(/\b\d{3}\D{0,2}\d{3}\D?\d{4}\b/g) ?? [];
    for (const n of numbers) expect(n.replace(/\D/g, "").slice(3, 6)).toBe("555");
  });
});
