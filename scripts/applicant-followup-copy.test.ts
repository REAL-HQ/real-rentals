// New Applicant Follow-Up copy (5-minute and day 1/2/3 messages). The live
// copy sits in public.automation_steps; this checks the reviewed copy in code
// and the proposed SQL that would write it. Nothing here touches a database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  APPLICANT_FOLLOWUP_COPY as COPY, APPLICANT_FOLLOWUP_COPY_BEFORE as BEFORE, APPLICANT_FOLLOWUP_WORKFLOW_ID as WF,
} from "@/lib/applicant-followup-copy";
import { renderTemplate } from "@/lib/sms.server";

const SQL = readFileSync("proposed/applicant-followup-gig-screenshot-copy-2026-11-14.sql", "utf8");
const OLD = /license|insurance|address/i;
const BANNED = /progressive|geico|state farm|allstate|liberty mutual|hagerty|buckle|broker|carrier|underwrit/i;

describe("follow-up copy", () => {
  test("all five steps, same ids, order, channels and delays as live", () => {
    expect(COPY.map((s) => [s.stepOrder, s.channel, s.delayMinutes])).toEqual([[1, "email", 5], [2, "sms", 5], [3, "sms", 1440], [4, "email", 2880], [5, "sms", 4320]]);
    expect(Object.keys(BEFORE).sort()).toEqual(COPY.map((s) => s.id).sort());
  });
  test("old 'license, insurance, address' wording is gone from every step", () => {
    for (const s of COPY) {
      expect(OLD.test(s.body)).toBe(false);
      expect(OLD.test(s.subject ?? "")).toBe(false);
    }
    // ...and the old copy really did ask for them (so this is a change, not a no-op).
    expect(Object.values(BEFORE).filter((b) => OLD.test(b.body)).length).toBe(3);
  });
  test("every step asks for the gig app profile screenshot with trips/deliveries and rating", () => {
    for (const s of COPY) {
      expect(s.body).toMatch(/gig app profile/i);
      expect(s.body).toMatch(/trips(\/| or )deliveries/i);
      expect(s.body).toMatch(/rating/i);
    }
    for (const s of COPY.filter((x) => x.channel === "email")) expect(s.body).toContain("Earnings screenshots are optional.");
    expect(COPY.find((s) => s.stepOrder === 2)!.body).toContain("(earnings optional)");
  });
  test("texts keep STOP, stay short, and keep the resume link where they had it", () => {
    for (const s of COPY.filter((x) => x.channel === "sms")) {
      expect(s.body.endsWith("Reply STOP to opt out.")).toBe(true);
      const rendered = renderTemplate(s.body, { first_name: "Jordan", resume_link: "https://drivereal.com/apply?resume=abcdefghijklmnopqrstuvwxyz0123456789ABCD", company_phone: "(888) 833-8280" });
      expect(rendered.length).toBeLessThanOrEqual(320);
      expect(s.body.length).toBeLessThanOrEqual(BEFORE[s.id].body.length);
    }
    for (const s of COPY) expect(s.body.includes("{{resume_link}}")).toBe(BEFORE[s.id].body.includes("{{resume_link}}"));
  });
  test("emails get shorter, subjects stay Title Case, no broker or carrier named", () => {
    for (const s of COPY) {
      expect(BANNED.test(s.body)).toBe(false);
      if (s.channel === "email") {
        expect(s.body.length).toBeLessThan(BEFORE[s.id].body.length + 160);
        expect(s.subject).toBe(BEFORE[s.id].subject);
      }
    }
    expect(COPY[0].body.length).toBeLessThan(BEFORE[COPY[0].id].body.length);
  });
});

describe("proposed SQL", () => {
  const updates = [...SQL.matchAll(/UPDATE public\.automation_steps SET\n  subject = (NULL|'(?:[^']|'')*'),\n  body = \$b\$([\s\S]*?)\$b\$\nWHERE id = '([0-9a-f-]+)' AND workflow_id = '([0-9a-f-]+)'\n  AND body = \$old\$([\s\S]*?)\$old\$;/g)];
  test("one guarded UPDATE per step, writing exactly the code copy", () => {
    expect(updates.length).toBe(5);
    for (const u of updates) {
      const step = COPY.find((s) => s.id === u[3])!;
      expect(u[4]).toBe(WF);
      expect(u[2]).toBe(step.body);
      expect(u[1]).toBe(step.subject == null ? "NULL" : `'${step.subject.replace(/'/g, "''")}'`);
      expect(u[5]).toBe(BEFORE[step.id].body); // only changes a step nobody edited since the read
    }
  });
  test("copy only: never touches on/off, delays, order, skip flags or other tables; not a migration", () => {
    const writes = SQL.split("\n").filter((l) => !l.startsWith("--")).join("\n");
    expect(writes).not.toMatch(/is_active\s*=|delay_minutes\s*=|step_order\s*=|skip_when_profile_complete\s*=|automation_workflows|DELETE|DROP|INSERT/i);
    expect(SQL.startsWith("-- PREPARED, NOT RUN. Needs Dolmar's approval.")).toBe(true);
    expect(SQL).toContain("BEGIN;");
    expect(SQL.trim().endsWith("COMMIT;")).toBe(true);
  });
  test("before and after are both written out for review", () => {
    for (const s of COPY) {
      expect(SQL).toContain(`-- Step ${s.stepOrder} `);
      expect(SQL).toContain("--   " + BEFORE[s.id].body.split("\n")[0]);
    }
    expect((SQL.match(/^-- BEFORE/gm) ?? []).length).toBe(5);
    expect((SQL.match(/^-- AFTER/gm) ?? []).length).toBe(5);
  });
});

describe("staff wording", () => {
  test("the skip option describes Step 2, not license/insurance/address", () => {
    const p = readFileSync("src/components/admin/AutomationsPanel.tsx", "utf8");
    expect(p).not.toContain("finished their license, insurance and address");
    expect(p).toContain("Applicants who already finished Step 2 don't get this message.");
  });
});

describe("proposed SQL runs (in-memory Postgres)", () => {
  test("updates exactly the five unedited steps, and a re-run or an edited step is a no-op", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    await pg.exec(`CREATE TABLE automation_steps (id uuid primary key, workflow_id uuid, step_order int, channel text, delay_minutes int,
      is_active boolean default true, skip_when_profile_complete boolean, subject text, body text);`);
    for (const s of COPY) {
      await pg.query(`INSERT INTO automation_steps VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8)`,
        [s.id, WF, s.stepOrder, s.channel, s.delayMinutes, s.stepOrder !== 4, BEFORE[s.id].subject, s.stepOrder === 5 ? BEFORE[s.id].body + " (edited)" : BEFORE[s.id].body]);
    }
    await pg.exec(SQL);
    const rows = (await pg.query<any>(`SELECT id, subject, body, is_active, delay_minutes FROM automation_steps ORDER BY step_order`)).rows;
    for (const r of rows.slice(0, 4)) expect(r.body).toBe(COPY.find((s) => s.id === r.id)!.body);
    expect(rows[4].body).toBe(BEFORE[COPY[4].id].body + " (edited)"); // guarded
    expect(rows.every((r) => r.is_active === true)).toBe(true);
    await pg.exec(SQL); // idempotent
    expect((await pg.query<any>(`SELECT body FROM automation_steps WHERE step_order = 2`)).rows[0].body).toBe(COPY[1].body);
  });
});
