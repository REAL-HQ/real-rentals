// Staff edit of the driver profile name and contact. Fake database; network refused.
// Fixtures use reserved 555 numbers and example.com only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => {
  throw new Error(`network refused in test: ${url}`);
}) as any;

import { fakeDb } from "./fleet-fake-db";
import {
  emailBelongsToAnotherProfile,
  normalizeDriverProfileEdit,
  profileUpdatedSummary,
  splitDriverName,
  waitingEmailTaken,
} from "@/lib/driver-profile-edit";
import { saveDriverProfileEdit, type ProfileEditActor } from "@/lib/driver-profile-edit.server";

const APP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PHONE = "+15550100000";
const OTHER_PHONE = "+15550100099";
const EMAIL = "regina@example.com";
const OTHER_EMAIL = "someone.else@example.com";

const manager: ProfileEditActor = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "ada@example.com",
  role: "team",
  tier: "manager",
};

function appRow(extra: Record<string, unknown> = {}) {
  return {
    id: APP,
    full_name: "Regina",
    email: EMAIL,
    phone: PHONE,
    city: "Tampa",
    state: "FL",
    status: "approved",
    deleted_at: null,
    sms_consent: true,
    ...extra,
  };
}

function draft(extra: Record<string, unknown> = {}) {
  return {
    applicationId: APP,
    firstName: "Regina",
    lastName: "Cole",
    phone: PHONE,
    email: EMAIL,
    city: "Tampa",
    state: "FL",
    ...extra,
  };
}

function seed(extra: { applications?: Record<string, unknown>[]; contacts?: Record<string, unknown>[]; addresses?: Record<string, unknown>[]; waitlist?: Record<string, unknown>[] } = {}) {
  return fakeDb({
    applications: extra.applications ?? [appRow()],
    driver_contacts: extra.contacts ?? [
      { id: "c-phone", application_id: APP, kind: "phone", value: PHONE, is_primary: true, receives_messages: true },
      { id: "c-email", application_id: APP, kind: "email", value: EMAIL, is_primary: true, receives_messages: true },
    ],
    driver_addresses: extra.addresses ?? [
      { id: "addr-1", application_id: APP, line1: "1 Main St", line2: null, city: "Tampa", state: "FL", zip: "33602", is_primary: true },
    ],
    waitlist: extra.waitlist ?? [
      {
        id: "wait-1",
        promoted_application_id: APP,
        status: "promoted",
        full_name: "Regina",
        email: EMAIL,
        phone: PHONE,
        city: "Tampa",
        state: "FL",
        market_id: "market-1",
      },
    ],
  });
}

describe("name and validation", () => {
  test("a one-word profile splits so a last name can be added", () => {
    expect(splitDriverName("Regina")).toEqual({ firstName: "Regina", lastName: "" });
    expect(splitDriverName("Regina Marie Cole")).toEqual({ firstName: "Regina", lastName: "Marie Cole" });
  });

  test("rejects a bad email and a bad phone, and accepts a last name", () => {
    expect(normalizeDriverProfileEdit({ firstName: "Regina", lastName: "Cole", phone: "5550100000", email: "not-an-email", city: "Tampa", state: "Florida" })).toMatchObject({
      ok: false,
      field: "email",
    });
    expect(normalizeDriverProfileEdit({ firstName: "Regina", lastName: "Cole", phone: "123", email: EMAIL, city: "", state: "" })).toMatchObject({
      ok: false,
      field: "phone",
    });
    const ok = normalizeDriverProfileEdit({ firstName: "Regina", lastName: "Cole", phone: "(555) 010-0000", email: "Regina@Example.com", city: "Tampa", state: "Florida" });
    expect(ok).toMatchObject({ ok: true, value: { fullName: "Regina Cole", email: EMAIL, phone: PHONE, city: "Tampa", state: "FL" } });
  });

  test("email collision ignores closed, declined and merged rows", () => {
    expect(emailBelongsToAnotherProfile(APP, [{ id: OTHER, status: "new", deleted_at: null }])).toBe(true);
    expect(emailBelongsToAnotherProfile(APP, [{ id: OTHER, status: "closed", deleted_at: null }])).toBe(false);
    expect(emailBelongsToAnotherProfile(APP, [{ id: OTHER, status: "declined", deleted_at: null }])).toBe(false);
    expect(emailBelongsToAnotherProfile(APP, [{ id: OTHER, status: "duplicate", deleted_at: null }])).toBe(false);
    expect(emailBelongsToAnotherProfile(APP, [{ id: OTHER, status: "approved", deleted_at: "2026-01-01" }])).toBe(false);
  });

  test("waitlist uniqueness is one waiting email per market", () => {
    expect(waitingEmailTaken(["wait-1"], "market-1", OTHER_EMAIL, [
      { id: "wait-2", status: "waiting", email: OTHER_EMAIL, market_id: "market-1" },
    ])).toBe(true);
    expect(waitingEmailTaken(["wait-1"], null, OTHER_EMAIL, [
      { id: "wait-2", status: "waiting", email: OTHER_EMAIL, market_id: null },
    ])).toBe(false);
    expect(profileUpdatedSummary("ada@example.com")).toBe("Profile updated by ada@example.com");
    expect(profileUpdatedSummary("  ")).toBe("Profile updated by Staff");
  });
});

describe("saveDriverProfileEdit", () => {
  test("adds a last name and keeps contacts, address and the linked waitlist row aligned", async () => {
    const db = seed();
    const audits: { summary: string; action: string }[] = [];
    const result = await saveDriverProfileEdit(db, manager, draft({ city: "Miami", state: "fl" }), async (entry) => {
      audits.push(entry);
    });
    expect(result.unchanged).toBe(false);
    expect(result.syncWarning).toBeNull();
    expect(result.profile.full_name).toBe("Regina Cole");
    expect(db.state.applications[0]).toMatchObject({ full_name: "Regina Cole", city: "Miami", state: "FL", sms_consent: true, email: EMAIL, phone: PHONE });
    expect(db.state.driver_addresses[0]).toMatchObject({ city: "Miami", state: "FL", line1: "1 Main St" });
    expect(db.state.waitlist[0].full_name).toBe("Regina Cole");
    expect(db.state.waitlist[0].city).toBe("Miami");
    expect(audits).toEqual([
      expect.objectContaining({ action: "application.profile_updated", summary: "Profile updated by ada@example.com", entityId: APP }),
    ]);
  });

  test("a new phone is stored in E.164, clears SMS consent, and updates the primary contact", async () => {
    const db = seed();
    const audits: unknown[] = [];
    const result = await saveDriverProfileEdit(db, manager, draft({ phone: "(555) 010-0099" }), async (entry) => {
      audits.push(entry);
    });
    expect(result.profile.phone).toBe(OTHER_PHONE);
    expect(result.profile.sms_consent).toBe(false);
    expect(db.state.applications[0].sms_consent).toBe(false);
    expect(db.state.applications[0].sms_opt_out_at).toBeNull();
    expect(db.state.driver_contacts.find((row) => row.kind === "phone")).toMatchObject({ value: OTHER_PHONE, is_primary: true });
    expect(audits).toHaveLength(1);
  });

  test("an email already on another live profile is refused and nothing is written", async () => {
    const db = seed({
      applications: [
        appRow(),
        { id: OTHER, full_name: "Other Driver", email: OTHER_EMAIL, phone: OTHER_PHONE, status: "reviewing", deleted_at: null },
      ],
    });
    const audits: unknown[] = [];
    await expect(saveDriverProfileEdit(db, manager, draft({ email: OTHER_EMAIL }), async (entry) => {
      audits.push(entry);
    })).rejects.toThrow(/already on another driver profile/);
    expect(db.state.applications[0].full_name).toBe("Regina");
    expect(db.state.applications[0].email).toBe(EMAIL);
    expect(audits).toHaveLength(0);
  });

  test("a closed application may share the email, and a shared phone is allowed", async () => {
    const db = seed({
      applications: [
        appRow(),
        { id: OTHER, full_name: "Old File", email: OTHER_EMAIL, phone: OTHER_PHONE, status: "closed", deleted_at: null },
      ],
    });
    const result = await saveDriverProfileEdit(db, manager, draft({ email: "Someone.Else@Example.com", phone: OTHER_PHONE }), async () => {});
    expect(result.profile.email).toBe(OTHER_EMAIL);
    expect(result.profile.phone).toBe(OTHER_PHONE);
    expect(db.state.driver_contacts.find((row) => row.kind === "email")?.value).toBe(OTHER_EMAIL);
  });

  test("a waiting waitlist row blocks an email that market already has", async () => {
    const db = seed({
      waitlist: [
        { id: "wait-1", promoted_application_id: APP, status: "waiting", full_name: "Regina", email: EMAIL, phone: PHONE, city: "Tampa", state: "FL", market_id: "market-1" },
        { id: "wait-2", promoted_application_id: null, status: "waiting", full_name: "Other", email: OTHER_EMAIL, phone: OTHER_PHONE, market_id: "market-1" },
      ],
    });
    await expect(saveDriverProfileEdit(db, manager, draft({ email: OTHER_EMAIL }), async () => {})).rejects.toThrow(/waitlist for this market/);
    expect(db.state.applications[0].email).toBe(EMAIL);
  });

  test("an unchanged profile does not write or audit", async () => {
    const db = seed();
    const audits: unknown[] = [];
    const result = await saveDriverProfileEdit(
      db,
      manager,
      draft({ lastName: "", phone: "(555) 010-0000", email: "Regina@Example.com" }),
      async (entry) => {
        audits.push(entry);
      },
    );
    expect(result.unchanged).toBe(true);
    expect(result.profile.full_name).toBe("Regina");
    expect(db.state.applications[0].full_name).toBe("Regina");
    expect(audits).toHaveLength(0);
  });

  test("a coordinator is refused before any write", async () => {
    const db = seed();
    const audits: unknown[] = [];
    await expect(
      saveDriverProfileEdit(db, { ...manager, tier: "coordinator", role: "coordinator" }, draft(), async (entry) => {
        audits.push(entry);
      }),
    ).rejects.toThrow("Forbidden");
    expect(db.state.applications[0].full_name).toBe("Regina");
    expect(audits).toHaveLength(0);
  });

  test("an existing extra contact is promoted instead of duplicated", async () => {
    const db = seed({
      contacts: [
        { id: "c-phone", application_id: APP, kind: "phone", value: PHONE, is_primary: true, receives_messages: true },
        { id: "c-extra", application_id: APP, kind: "phone", value: OTHER_PHONE, is_primary: false, receives_messages: false },
        { id: "c-email", application_id: APP, kind: "email", value: EMAIL, is_primary: true, receives_messages: true },
      ],
    });
    await saveDriverProfileEdit(db, manager, draft({ phone: OTHER_PHONE }), async () => {});
    const phones = db.state.driver_contacts.filter((row) => row.kind === "phone");
    expect(phones).toHaveLength(2);
    expect(phones.find((row) => row.id === "c-extra")).toMatchObject({ is_primary: true, value: OTHER_PHONE });
    expect(phones.find((row) => row.id === "c-phone")).toMatchObject({ is_primary: false, value: PHONE });
  });
});

describe("wiring", () => {
  const dialog = readFileSync("src/components/admin/EditDriverProfileDialog.tsx", "utf8");
  const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  const server = readFileSync("src/lib/driver-profile-edit.server.ts", "utf8");
  const fn = readFileSync("src/lib/driver-profile-edit.functions.ts", "utf8");

  test("Edit Profile is Manager+ in the header pencil and the menu", () => {
    expect(panel).toContain('data-testid="edit-driver-profile"');
    expect(panel).toContain('data-testid="edit-driver-profile-menu"');
    expect(panel).toContain("Edit Profile");
    expect(panel).toMatch(/\{isManager \? \(\s*<button[\s\S]*data-testid="edit-driver-profile"/);
    expect(panel).toMatch(/\{isManager \? \(\s*<DropdownMenuItem[\s\S]*Edit Profile/);
    expect(fn).toContain("requireManager(context.userId)");
    expect(fn).toContain("requireStaff(context.userId)");
  });

  test("labels are Title Case and no phone number is hardcoded", () => {
    for (const label of ["Edit Profile", "First Name", "Last Name", "Phone", "Email", "City", "State", "Save Profile", "No Message Is Sent"]) {
      expect(dialog).toContain(label);
    }
    expect(dialog).not.toMatch(/uppercase|text-transform|capitalize/);
    expect(dialog).not.toMatch(/\+1\d{10}|\(\d{3}\) \d{3}|\d{3}-\d{3}-\d{4}/);
  });

  test("the save path does not email, text, or call Stripe", () => {
    expect(`${server}\n${fn}`).not.toMatch(/sendEmail\(|sendSms\(|sendRenter|stripe\.customers|from\(["']stripe/);
    expect(server).toContain("Profile updated by");
    expect(panel).toContain("row.summary");
  });
});
