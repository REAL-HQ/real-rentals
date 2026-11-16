// Returning-applicant link email: who it greets by name.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resumeGreetingName } from "@/lib/email.server";

describe("resumeGreetingName", () => {
  test("name on file agrees with the name typed: greet by it", () => {
    expect(resumeGreetingName("Dolmar Cross", "dolmar cross")).toBe("Dolmar");
  });
  test("no name typed (Continue Application button): use the name on file", () => {
    expect(resumeGreetingName("Jordan Sample", null)).toBe("Jordan");
  });
  test("names disagree: neutral greeting, never either name", () => {
    expect(resumeGreetingName("ESIGN Smoke", "Dolmar Cross")).toBeNull();
    expect(resumeGreetingName("Jordan Sample", "Sam Lee")).toBeNull();
  });
  test("placeholder or test names on file never greet anyone", () => {
    expect(resumeGreetingName("ESIGN Test", null)).toBeNull();
    expect(resumeGreetingName("TEST DELETE ME", "Test Delete")).toBeNull();
    expect(resumeGreetingName("", "Dolmar")).toBeNull();
  });
});

describe("wiring", () => {
  const fns = readFileSync("src/lib/applications.functions.ts", "utf8");
  const rec = readFileSync("src/lib/application-recovery.server.ts", "utf8");
  const mail = readFileSync("src/lib/email.server.ts", "utf8");
  test("both send paths pass the typed name through", () => {
    expect(fns).toContain("emailLinkToAddressOnFile(supabaseAdmin, primaryId, submittedNameOf(entry))");
    expect(fns).toContain("deliverApplicationRecovery(supabaseAdmin, primaryId, { submittedName: submittedNameOf(entry) })");
    expect(rec).toContain("submittedName: opts.submittedName ?? null");
  });
  test("heading drops the name instead of printing a wrong one", () => {
    expect(mail).toContain('Continue Your Application${name ? `, ${escapeHtml(name)}` : ""}</h1>');
  });
});
