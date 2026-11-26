// Phone matches an application, email does not (Dolmar): the browser gets a
// masked hint only, the email box stays empty (covered in
// returning-applicant-link.test.ts), and team@ gets one alert per lead per
// hour. A failed alert does not throw.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isMaskedEmailHint, maskEmailOnFile } from "@/lib/email-on-file-mask";
import {
  PHONE_MATCH_ALERT_DEDUPE_MS,
  formatPhoneMatchAlertTime,
  phoneEnding,
  phoneMatchAlertContent,
  sendPhoneMatchEmailDiffersAlert,
} from "@/lib/phone-match-alert.server";
import { TEAM_ALERT_EMAIL } from "@/lib/team-alerts";

const ON_FILE = "mystery@gmail.com";
const HINT = "m•••••y@gmail.com";

describe("maskEmailOnFile", () => {
  test("first and last of the local part, bullets between, full domain", () => {
    expect(maskEmailOnFile(ON_FILE)).toBe(HINT);
    expect(maskEmailOnFile("  Money@Gmail.COM ")).toBe("m•••y@gmail.com");
    expect(maskEmailOnFile("abc@gmail.com")).toBe("a•c@gmail.com");
    expect("someone.else".length).toBe(12);
    expect(maskEmailOnFile("someone.else@example.com")).toBe("s••••••••••e@example.com");
  });

  test("local parts of one or two characters show only the first character plus bullets", () => {
    expect(maskEmailOnFile("a@gmail.com")).toBe("a••@gmail.com");
    expect(maskEmailOnFile("ab@gmail.com")).toBe("a••@gmail.com");
    expect(maskEmailOnFile("ab@gmail.com")).not.toContain("b@");
  });

  test("refuses a value that is not an address", () => {
    for (const bad of ["", "   ", null, undefined, "plain", "@gmail.com", "nobody@", "a@b", "a@@b.com", "a b@gmail.com"]) {
      expect(maskEmailOnFile(bad as string)).toBeNull();
    }
  });

  test("the hint check accepts the mask and rejects the full address", () => {
    expect(isMaskedEmailHint(HINT)).toBe(true);
    expect(isMaskedEmailHint("a••@gmail.com")).toBe(true);
    expect(isMaskedEmailHint("a•c@gmail.com")).toBe(true);
    expect(isMaskedEmailHint(ON_FILE)).toBe(false);
    expect(isMaskedEmailHint("someone.else@example.com")).toBe(false);
    expect(isMaskedEmailHint("m•••••y@gmail")).toBe(false);
    expect(maskEmailOnFile(ON_FILE)).not.toBe(ON_FILE);
  });
});

describe("phone ending", () => {
  test("keeps four digits and drops anything else", () => {
    expect(phoneEnding("0199")).toBe("0199");
    expect(phoneEnding("8135550199")).toBe("");
    expect(phoneEnding("199")).toBe("");
    expect(phoneEnding("")).toBe("");
  });
});

type Row = Record<string, any>;

function fakeAdmin(rows: Row[]) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "insert" = "select";
      let payload: Row | null = null;
      let lim = Infinity;
      const run = () => {
        if (table !== "outbound_messages") return [];
        if (op === "insert" && payload) {
          rows.push({ id: `msg-${rows.length + 1}`, ...payload });
          return [rows.at(-1)];
        }
        return rows.filter((r) => filters.every((f) => f(r))).slice(0, lim);
      };
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        gte: (k: string, v: unknown) => (filters.push((r) => String(r[k]) >= String(v)), q),
        limit: (n: number) => ((lim = n), q),
        insert: (p: Row) => ((op = "insert"), (payload = p), q),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({ data: run(), error: null }).then(res, rej),
      };
      return q;
    },
  };
}

const LEAD = "10000000-0000-4000-8000-000000000001";
const NEW_EMAIL = "jayson.new@gmail.com";
const AT = new Date("2026-11-24T18:48:00.000Z");
const args = { leadId: LEAD, applicantName: "Jayson Fonseca", newEmail: NEW_EMAIL, phoneLast4: "0199" };

describe("team alert", () => {
  test("email names the applicant, the lead, the time in ET, the new email, and only the last four", () => {
    const content = phoneMatchAlertContent(args, AT);
    expect(formatPhoneMatchAlertTime(AT)).toBe("Nov 24, 2026, 1:48 PM ET");
    expect(content.subject).toBe("Email Doesn't Match: Jayson Fonseca");
    expect(content.link).toBe(`https://drivereal.com/admin?tab=drivers&id=${LEAD}`);
    expect(content.html).toContain("Email Doesn't Match");
    expect(content.html).toContain("Jayson Fonseca");
    expect(content.html).toContain(LEAD);
    expect(content.html).toContain("Nov 24, 2026, 1:48 PM ET");
    expect(content.html).toContain(NEW_EMAIL);
    expect(content.html).toContain("Phone ending in: 0199");
    expect(content.html).toContain(`href="${content.link.replace(/&/g, "&amp;")}"`);
    expect(content.html).toContain("Open In Admin");
    expect(content.html).not.toContain(ON_FILE);
    expect(content.text.replaceAll(LEAD, "")).not.toMatch(/\d{10}|\(\d{3}\)/);
    expect(content.html).not.toContain("8135550199");

    const hidden = phoneMatchAlertContent({ ...args, phoneLast4: "8135550199" }, AT);
    expect(hidden.html).not.toContain("8135550199");
    expect(hidden.html).not.toContain("Phone ending in");
    expect(hidden.text.replaceAll(LEAD, "")).not.toMatch(/\d{7,}/);
  });

  test("sends once per lead within an hour, then again after the hour", async () => {
    const rows: Row[] = [];
    const sent: any[] = [];
    let now = AT;
    const sendEmail = async (message: any) => {
      sent.push(message);
      return { ok: true };
    };
    const deps = { sendEmail, now: () => now };
    const admin = fakeAdmin(rows);
    expect((await sendPhoneMatchEmailDiffersAlert(admin, args, deps)).status).toBe("sent");
    expect((await sendPhoneMatchEmailDiffersAlert(admin, { ...args, newEmail: "another.wrong@gmail.com" }, deps)).status).toBe("deduped");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(TEAM_ALERT_EMAIL);
    expect(sent[0].subject).toBe("Email Doesn't Match: Jayson Fonseca");
    expect(sent[0].html).toContain(NEW_EMAIL);
    expect(sent[0].html).not.toContain("another.wrong@gmail.com");
    expect(sent[0].track).toMatchObject({ workflow: "phone_match_email_differs", meta: { applicationId: LEAD } });
    expect(sent[0].idempotencyKey).toBe(`phone-match-email-differs/${LEAD}/${Math.floor(AT.getTime() / PHONE_MATCH_ALERT_DEDUPE_MS)}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("phone_match_email_differs");
    expect(rows[0].status).toBe("sent");
    expect(rows[0].to_address).toBe(TEAM_ALERT_EMAIL);
    expect(String(rows[0].body).replaceAll(LEAD, "")).not.toMatch(/\d{10}|\(\d{3}\)/);

    now = new Date(AT.getTime() + PHONE_MATCH_ALERT_DEDUPE_MS + 1000);
    expect((await sendPhoneMatchEmailDiffersAlert(admin, args, deps)).status).toBe("sent");
    expect(sent).toHaveLength(2);
    expect(sent[1].idempotencyKey).not.toBe(sent[0].idempotencyKey);
  });

  test("a failed send does not throw and does not consume the hour", async () => {
    const rows: Row[] = [];
    const sent: any[] = [];
    const admin = fakeAdmin(rows);
    const failed = await sendPhoneMatchEmailDiffersAlert(admin, args, {
      now: () => AT,
      sendEmail: async () => {
        throw new Error("Resend is down");
      },
    });
    expect(failed.status).toBe("failed");
    expect(rows).toHaveLength(0);

    const rejected = await sendPhoneMatchEmailDiffersAlert(admin, args, {
      now: () => AT,
      sendEmail: async () => ({ ok: false }),
    });
    expect(rejected.status).toBe("failed");
    expect(rows).toHaveLength(0);

    const recovered = await sendPhoneMatchEmailDiffersAlert(admin, args, {
      now: () => AT,
      sendEmail: async (message) => {
        sent.push(message);
        return { ok: true };
      },
    });
    expect(recovered.status).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  test("the alert module has no renter phone number in source", () => {
    const src = readFileSync("src/lib/phone-match-alert.server.ts", "utf8");
    expect(src).not.toMatch(/\+1\d{10}/);
    expect(src).not.toMatch(/\(\d{3}\)\s*\d{3}/);
    expect(src).not.toMatch(/phoneLast4:\s*data\.phone/);
    expect(src).toContain("TEAM_ALERT_EMAIL");
  });
});
