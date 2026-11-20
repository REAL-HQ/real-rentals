import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { identifierKindLabel, normalizePersonName, referenceMatchKinds } from "../src/lib/blacklist";
import { CONTACT_PEOPLE_FIELDS, CONTACT_PEOPLE_LABELS, contactPeopleFromRow, contactPeopleSchema, hasAnyContactPeople } from "../src/lib/application-contacts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("reference and emergency contact fields", () => {
  test("six optional fields, Title Case labels", () => {
    expect(CONTACT_PEOPLE_FIELDS.length).toBe(6);
    for (const k of CONTACT_PEOPLE_FIELDS) {
      for (const w of CONTACT_PEOPLE_LABELS[k].split(" ")) expect(w[0]).toBe(w[0].toUpperCase());
    }
  });
  test("validation: all optional; blank becomes null; phone must be a real number; name needs 2+ characters", () => {
    expect(contactPeopleSchema.parse({})).toEqual({});
    expect(contactPeopleSchema.parse({ reference_name: "  ", reference_phone: "" })).toEqual({ reference_name: null, reference_phone: null });
    expect(contactPeopleSchema.parse({ emergency_contact_phone: "(555) 010-2222" }).emergency_contact_phone).toBe("(555) 010-2222");
    expect(() => contactPeopleSchema.parse({ reference_phone: "12345" })).toThrow(/10-Digit/);
    expect(() => contactPeopleSchema.parse({ reference_name: "A" })).toThrow(/Full Name/);
    expect(() => contactPeopleSchema.parse({ reference_relationship: "x".repeat(61) })).toThrow();
  });
  test("row helpers", () => {
    const p = contactPeopleFromRow({ reference_name: " Ann Lee ", emergency_contact_phone: "", other: "x" });
    expect(p.reference_name).toBe("Ann Lee");
    expect(p.emergency_contact_phone).toBeNull();
    expect(hasAnyContactPeople(p)).toBe(true);
    expect(hasAnyContactPeople(contactPeopleFromRow(null))).toBe(false);
  });
  test("wired into the applicant step save, the wizard, staff edits and the admin profile", () => {
    const fn = src("src/lib/applications.functions.ts");
    expect(fn).toMatch(/\.\.\.contactPeopleShape,/);
    for (const k of CONTACT_PEOPLE_FIELDS) expect(fn).toContain(`"${k}",`);
    expect(src("src/lib/application-lifecycle.functions.ts")).toMatch(/\.\.\.contactPeopleShape,/);
    const wiz = src("src/components/site/ApplicationWizard.tsx");
    expect(wiz).toMatch(/key: "contacts"/);
    expect(wiz).toMatch(/Reference And Emergency Contact \(Optional\)/);
    expect(wiz).toMatch(/optional: true/);
    expect(wiz).toMatch(/required\.filter\(\(s\) => s\.done\)/);
    const panel = src("src/components/admin/DriversPanel.tsx");
    expect(panel).toMatch(/title="Reference And Emergency Contact"/);
    expect(panel).toMatch(/CONTACT_PEOPLE_FIELDS\.map/);
  });
});

describe("blacklist matching on references", () => {
  const heather = { fullName: "Heather Bell", phones: ["+1 (555) 010-0106"] };
  test("names normalize like the database", () => {
    expect(normalizePersonName("  Heather  A. Bell Jr ")).toBe("heather a bell");
    expect(normalizePersonName("Heather")).toBeNull();
    expect(normalizePersonName("HEATHER BELL")).toBe("heather bell");
  });
  test("reference phone, reference name, emergency phone, emergency name", () => {
    expect(referenceMatchKinds({ reference_phone: "555-010-0106" }, heather)).toEqual(["reference_phone"]);
    expect(referenceMatchKinds({ reference_name: "heather bell" }, heather)).toEqual(["reference_name"]);
    expect(referenceMatchKinds({ emergency_contact_phone: "15550100106" }, heather)).toEqual(["emergency_phone"]);
    expect(referenceMatchKinds({ emergency_contact_name: "Heather Bell" }, heather)).toEqual(["emergency_name"]);
    expect(referenceMatchKinds({ reference_name: "Heather Bell", reference_phone: "5550100106" }, heather)).toEqual(["reference_name", "reference_phone"]);
  });
  test("different people do not match", () => {
    expect(referenceMatchKinds({ reference_name: "Heather Bello", reference_phone: "5550109999", emergency_contact_name: "Bell" }, heather)).toEqual([]);
  });
  test("staff see readable labels", () => {
    expect(identifierKindLabel("reference_phone")).toBe("Reference Phone");
    expect(identifierKindLabel("emergency_name")).toBe("Emergency Contact Name");
  });
  test("migration: columns, matching function, trigger columns, scan uses full matching", () => {
    const sql = src("supabase/migrations/20261120130000_application_references.sql");
    for (const k of CONTACT_PEOPLE_FIELDS) expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${k} text`);
    expect(sql).toMatch(/private\.blacklist_reference_hits\(_app\)/);
    expect(sql).toMatch(/reference_name, reference_phone, emergency_contact_name, emergency_contact_phone ON public\.applications/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM private\.blacklist_matches\(a\.id\) m WHERE m\.blacklist_id = NEW\.id\)/);
    expect(sql).not.toMatch(/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/);
  });
});
