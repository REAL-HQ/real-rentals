/**
 * Apply step 1 (t312u): SMS consent checkbox is a normal size, and Mobile
 * Phone auto-formats as the applicant types. The submitted/stored value is
 * E.164 so Quo, dedupe, and outreach still see a contiguous digit run.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applicantPhoneForSubmit,
  applicantPhoneLookupValues,
  formatUsPhoneInput,
  usPhoneE164,
} from "../src/lib/us-phone";

const SAMPLE = "8135550123";

describe("formatUsPhoneInput", () => {
  test("formats a 10-digit national number as the user types", () => {
    expect(formatUsPhoneInput("")).toBe("");
    expect(formatUsPhoneInput("8")).toBe("(8");
    expect(formatUsPhoneInput("81")).toBe("(81");
    expect(formatUsPhoneInput("813")).toBe("(813");
    expect(formatUsPhoneInput("8135")).toBe("(813) 5");
    expect(formatUsPhoneInput("813555")).toBe("(813) 555");
    expect(formatUsPhoneInput("8135550")).toBe("(813) 555-0");
    expect(formatUsPhoneInput("8135550123")).toBe("(813) 555-0123");
  });

  test("strips a leading 1 or +1, including mid-entry and paste", () => {
    expect(formatUsPhoneInput("1")).toBe("1");
    expect(formatUsPhoneInput("18")).toBe("(8");
    expect(formatUsPhoneInput("18135550123")).toBe("(813) 555-0123");
    expect(formatUsPhoneInput("+18135550123")).toBe("(813) 555-0123");
    expect(formatUsPhoneInput("+1 (813) 555-0123")).toBe("(813) 555-0123");
    expect(formatUsPhoneInput("1-813-555-0123")).toBe("(813) 555-0123");
    expect(formatUsPhoneInput("18135550123999")).toBe("(813) 555-0123");
  });

  test("is idempotent on an already-formatted value (autofill / blur)", () => {
    expect(formatUsPhoneInput("(813) 555-0123")).toBe("(813) 555-0123");
    expect(formatUsPhoneInput("(813) 555-012")).toBe("(813) 555-012");
  });

  test("backspacing through punctuation removes a real digit", () => {
    const full = formatUsPhoneInput("8135550123");
    expect(full).toBe("(813) 555-0123");
    // User deletes the last visible character ("3") — digits become 813555012.
    expect(formatUsPhoneInput(full.slice(0, -1))).toBe("(813) 555-012");
    // At 3 digits the closing paren is not shown, so backspacing the 3rd
    // digit does not bounce off a formatter-reinserted ")".
    expect(formatUsPhoneInput("(813")).toBe("(813");
    expect(formatUsPhoneInput("(81")).toBe("(81");
  });
});

describe("applicantPhoneForSubmit / usPhoneE164", () => {
  test("stores valid US numbers as E.164, matching toE164 / businessPhoneE164", () => {
    for (const raw of [
      "8135550123",
      "18135550123",
      "+18135550123",
      "(813) 555-0123",
      "+1 (813) 555-0123",
      "813-555-0123",
      " 813.555.0123 ",
    ]) {
      expect(applicantPhoneForSubmit(raw)).toBe("+18135550123");
      expect(usPhoneE164(raw)).toBe("+18135550123");
    }
  });

  test("the E.164 value still contains the last-10 digit run Quo ilike uses", () => {
    const stored = applicantPhoneForSubmit("(813) 555-0123");
    expect(stored.includes(SAMPLE)).toBe(true);
    // A pretty display string would break `.ilike('%8135550123%')`.
    expect("(813) 555-0123".includes(SAMPLE)).toBe(false);
  });

  test("leaves a non-US but still valid 7+ character value trimmed, not invented", () => {
    expect(applicantPhoneForSubmit(" 5550123 ")).toBe("5550123");
    expect(usPhoneE164("5550123")).toBe(null);
  });
});

describe("applicantPhoneLookupValues", () => {
  test("covers common typings of the same number for duplicate detection", () => {
    const values = applicantPhoneLookupValues("(813) 555-0123");
    expect(values).toContain("+18135550123");
    expect(values).toContain("18135550123");
    expect(values).toContain("8135550123");
    expect(values).toContain("(813) 555-0123");
    expect(values).toContain("813-555-0123");
    // Built from digits only — never a raw attacker string.
    expect(values.every((v) => !v.includes(","))).toBe(true);
    expect(applicantPhoneLookupValues("+1 (813) 555-0123").sort()).toEqual(values.sort());
  });
});

describe("apply / lead form wiring", () => {
  const apply = readFileSync("src/routes/apply.tsx", "utf8");
  const lead = readFileSync("src/components/site/CityHeroLeadForm.tsx", "utf8");
  const consent = readFileSync("src/components/site/SmsConsentField.tsx", "utf8");
  const save = readFileSync("src/lib/applications.functions.ts", "utf8");

  test("the SMS consent checkbox is a normal 18px box, not h-11 w-11", () => {
    // t369u: drawn by the shared CheckboxInput (appearance-none, fixed px) so
    // no browser can render it as an oversized native control.
    expect(consent).toMatch(/<CheckboxInput\b/);
    expect(consent).not.toMatch(/\bh-11 w-11\b/);
    expect(consent).toMatch(/flex items-start gap-3/);
    // Disclosure indent matches the 18px box + gap-3 (not the old 44px box).
    expect(consent).toMatch(/className="mt-2 pl-\[30px\] /);
    expect(consent).not.toMatch(/\bpl-14\b/);
    const box = readFileSync("src/components/ui/checkbox-input.tsx", "utf8");
    expect(box).toMatch(/h-\[18px\] w-\[18px\]/);
    expect(box).toMatch(/appearance-none/);
    expect(box).toMatch(/type="checkbox"/);
  });

  test("no other apply-flow checkbox uses the oversized h-11 w-11 style", () => {
    const wizard = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
    const checkboxLines = (src: string) =>
      src.split("\n").filter((line) => /type=["']checkbox["']/.test(line) || /h-11 w-11/.test(line));
    for (const file of [consent, apply, lead, wizard]) {
      const oversized = checkboxLines(file).filter((line) => /\bh-11 w-11\b/.test(line) && /checkbox/.test(line));
      expect(oversized).toEqual([]);
    }
    // The insurance consent in the wizard (later apply step) uses the same box.
    expect(wizard).toMatch(/<CheckboxInput[\s\S]{0,200}checked=\{insuranceConsent\}/);
  });

  test("the contact step formats as the user types and submits E.164", () => {
    // Shared PhoneInput (formatUsPhoneInput on change and blur, mode "us").
    expect(apply).toMatch(/<PhoneInput\s+mode="us"/);
    expect(apply).toMatch(/applicantPhoneForSubmit\(form\.phone\)/);
    expect(apply).toMatch(/type === "tel" \? \(/);
    expect(lead).toMatch(/<PhoneInput mode="us"/);
    expect(lead).toMatch(/applicantPhoneForSubmit\(form\.phone\)/);
    const shared = readFileSync("src/components/ui/phone-input.tsx", "utf8");
    expect(shared).toMatch(/mode === "us" \? formatUsPhoneInput : formatPhoneInput/);
    expect(shared).toMatch(/onBlur=\{/);
  });

  test("savePartialApplication stores E.164 and looks up common typings", () => {
    expect(save).toMatch(/phone: applicantPhoneForSubmit\(raw\.phone\)/);
    expect(save).toMatch(/\.in\("phone", applicantPhoneLookupValues\(data\.phone\)\)/);
    expect(save).not.toMatch(/\.eq\("phone", data\.phone\)/);
  });
});
