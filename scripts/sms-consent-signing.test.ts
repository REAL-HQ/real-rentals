/**
 * Rental SMS opt-in on agreement signing and the Reservation Fee page.
 * Fake database. No network, no real phone numbers in the server modules.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RENTAL_SMS_CONSENT_TEXT, RENTAL_SMS_CONSENT_VERSION, smsConsentMissing } from "../src/lib/sms-consent";
import {
  captureSignerSmsConsent,
  issueReservationFeeConsentTicket,
  readReservationFeeConsentTicket,
  resolveSignerConsent,
} from "../src/lib/sms-consent-signing.server";
import { SigningPanel } from "../src/components/esign/SigningPanel";
import { ReservationFeeNextStep } from "../src/components/esign/ReservationFeeNextStep";
import { PaymentNotCompletedPage } from "../src/components/reservation/PaymentNotCompletedPage";
import { EMPTY_PNC_VIEW } from "../src/lib/payment-not-completed";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-secret";

const TEXT = "Text me about my rental (pickup, payment reminders and account updates). Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help.";
const shown = (html: string) => html.replace(/&amp;/g, "&");
const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REC1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REC2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DRIVER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PHONE = "+18135550100";
const OTHER = "+18135550199";

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  function from(table: string) {
    state[table] ??= [];
    let op = "select";
    let payload: any = null;
    let single = false;
    const filters: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q,
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      delete: () => { op = "delete"; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = state[table];
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        const row = { id: payload.id ?? `${table}-${rows.length + 1}`, ...payload };
        rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      if (op === "update") {
        for (const r of hit) Object.assign(r, payload);
        return { data: single ? hit[0] ?? null : hit, error: null };
      }
      if (op === "delete") {
        state[table] = rows.filter((r) => !hit.includes(r));
        return { data: hit, error: null };
      }
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    return q;
  }
  return { from, state };
}

function seed(consent = false) {
  return fakeDb({
    agreements: [{ id: AG, application_id: APP }],
    applications: [{ id: APP, phone: "(813) 555-0100", sms_consent: consent, sms_opt_out_at: null }],
    esign_recipients: [
      { id: REC1, document_id: AG, email: "primary@example.com", phone: PHONE, signing_order: 1, role: "signer" },
      { id: REC2, document_id: AG, email: "extra@example.com", phone: OTHER, signing_order: 2, role: "signer" },
    ],
    rental_additional_drivers: [{ id: DRIVER, application_id: APP, email: "extra@example.com", phone: OTHER, sms_consent: false, removed_at: null }],
    sms_consent_log: [],
    sms_opt_outs: [],
    driver_contacts: [],
  });
}

describe("when the checkbox is shown", () => {
  test("hidden when consent is already true", () => {
    expect(smsConsentMissing(true)).toBe(false);
    const html = renderToStaticMarkup(createElement(SigningPanel, {
      body: "Agreement body",
      defaultName: "Ada Lovelace",
      busy: false,
      onSubmit: () => {},
    }));
    expect(html).not.toContain(TEXT);
    expect(html).not.toContain("signing-sms-consent");
  });

  test("shown unchecked when consent is missing", () => {
    expect(smsConsentMissing(false)).toBe(true);
    expect(smsConsentMissing(null)).toBe(true);
    const html = renderToStaticMarkup(createElement(SigningPanel, {
      body: "Agreement body",
      defaultName: "Ada Lovelace",
      busy: false,
      onSubmit: () => {},
      smsConsent: { checked: false, onChange: () => {} },
    }));
    expect(shown(html)).toContain(TEXT);
    expect(html).toContain('data-testid="signing-sms-consent"');
    expect(html).not.toMatch(/name="rental_sms_consent"[^>]*\schecked(?:=|\s|>)/);
    expect(RENTAL_SMS_CONSENT_TEXT).toBe(TEXT);
    for (const file of ["src/routes/sign.$token.tsx", "src/routes/portal.tsx", "src/components/reservation/PaymentNotCompletedPage.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("const [smsChecked, setSmsChecked] = useState(false)");
      expect(source).not.toContain("setSmsChecked(true)");
    }
  });

  test("Reservation Fee page shows the same wording only when still needed", () => {
    const plain = renderToStaticMarkup(createElement(ReservationFeeNextStep, {
      step: { state: "pay", amount: 50, url: "https://checkout.stripe.com/c/pay/cs_1" },
      autoRedirect: false,
    }));
    expect(plain).not.toContain(TEXT);
    expect(plain).toContain("Pay $50.00 Reservation Fee");
    expect(plain).not.toMatch(/deposit/i);
    const ask = renderToStaticMarkup(createElement(ReservationFeeNextStep, {
      step: { state: "pay", amount: 50, url: "https://checkout.stripe.com/c/pay/cs_1" },
      smsConsent: { checked: false, onChange: () => {}, onCommit: async () => {} },
    }));
    expect(shown(ask)).toContain(TEXT);
    expect(ask).toContain('data-testid="reservation-fee-sms-consent"');
    expect(ask).not.toMatch(/name="rental_sms_consent"[^>]*\schecked(?:=|\s|>)/);
    expect(ask).not.toContain("Taking you to secure checkout");
    const page = renderToStaticMarkup(createElement(PaymentNotCompletedPage, {
      view: { ...EMPTY_PNC_VIEW, smsConsentNeeded: true, checkoutUrl: "https://checkout.stripe.com/c/pay/cs_1" },
      onReserve: async () => {},
    }));
    expect(shown(page)).toContain(TEXT);
    expect(page).not.toMatch(/name="rental_sms_consent"[^>]*\schecked(?:=|\s|>)/);
    expect(page).not.toMatch(/deposit/i);
    const quiet = renderToStaticMarkup(createElement(PaymentNotCompletedPage, { view: EMPTY_PNC_VIEW }));
    expect(quiet).not.toContain(TEXT);
  });
});

describe("signing writes", () => {
  test("checked sign sets consent and logs the exact text and version", async () => {
    const db = seed(false);
    const result = await captureSignerSmsConsent(db, {
      agreementId: AG,
      applicationId: APP,
      recipientId: REC1,
      consent: true,
      source: "agreement_signing",
      ip: "203.0.113.9",
      userAgent: "TestAgent",
      phone: OTHER,
    } as any);
    expect(result).toMatchObject({ recorded: true, consent: true, phone: PHONE });
    expect(db.state.applications[0].sms_consent).toBe(true);
    expect(db.state.applications[0].sms_consent_text).toBe(TEXT);
    expect(db.state.applications[0].sms_consent_version).toBe(RENTAL_SMS_CONSENT_VERSION);
    expect(db.state.applications[0].sms_consent_source).toBe("agreement_signing");
    expect(db.state.applications[0].sms_consent_phone).toBe(PHONE);
    const log = db.state.sms_consent_log[0];
    expect(log.wording).toBe(TEXT);
    expect(log.wording_version).toBe(RENTAL_SMS_CONSENT_VERSION);
    expect(log.consent).toBe(true);
    expect(log.source).toBe("agreement_signing");
    expect(log.phone).toBe(PHONE);
    expect(log.phone).not.toBe(OTHER);
    expect(log.application_id).toBe(APP);
    expect(log.additional_driver_id).toBeNull();
    expect(log.esign_recipient_id).toBe(REC1);
    expect(log.agreement_id).toBe(AG);
    expect(log.ip).toBe("203.0.113.9");
    expect(log.consented_at).toBeTruthy();
  });

  test("unchecked leaves consent false and logs the decline", async () => {
    const db = seed(false);
    const result = await captureSignerSmsConsent(db, {
      agreementId: AG,
      applicationId: APP,
      recipientId: REC1,
      consent: false,
      source: "agreement_signing",
      ip: null,
      userAgent: null,
    });
    expect(result.consent).toBe(false);
    expect(result.stillNeeded).toBe(true);
    expect(db.state.applications[0].sms_consent).toBe(false);
    expect(db.state.applications[0].sms_consent_text).toBeUndefined();
    expect(db.state.sms_consent_log).toHaveLength(1);
    expect(db.state.sms_consent_log[0].consent).toBe(false);
    expect(db.state.sms_consent_log[0].wording).toBe(TEXT);
  });

  test("an already consented signer is not opted out", async () => {
    const db = seed(true);
    const subject = await resolveSignerConsent(db, { agreementId: AG, applicationId: APP, recipientId: REC1 });
    expect(subject.consented).toBe(true);
    const result = await captureSignerSmsConsent(db, {
      agreementId: AG,
      applicationId: APP,
      recipientId: REC1,
      consent: false,
      source: "agreement_signing",
      ip: null,
      userAgent: null,
    });
    expect(result.recorded).toBe(false);
    expect(db.state.applications[0].sms_consent).toBe(true);
    expect(db.state.sms_consent_log).toHaveLength(0);
  });

  test("an additional driver is recorded on their own row, not the primary renter", async () => {
    const db = seed(false);
    const result = await captureSignerSmsConsent(db, {
      agreementId: AG,
      applicationId: APP,
      recipientId: REC2,
      consent: true,
      source: "agreement_signing",
      ip: "203.0.113.10",
      userAgent: "Extra",
    });
    expect(result.phone).toBe(OTHER);
    expect(db.state.applications[0].sms_consent).toBe(false);
    expect(db.state.rental_additional_drivers[0].sms_consent).toBe(true);
    const log = db.state.sms_consent_log[0];
    expect(log.application_id).toBeNull();
    expect(log.additional_driver_id).toBe(DRIVER);
    expect(log.esign_recipient_id).toBe(REC2);
    expect(log.wording).toBe(TEXT);
    expect(log.phone).toBe(OTHER);
    const primary = await resolveSignerConsent(db, { agreementId: AG, applicationId: APP, recipientId: REC1 });
    expect(primary.consented).toBe(false);
    const extra = await resolveSignerConsent(db, { agreementId: AG, applicationId: APP, recipientId: REC2 });
    expect(extra.consented).toBe(true);
  });

  test("Reservation Fee source is separate and uses the phone on file", async () => {
    const db = seed(false);
    await captureSignerSmsConsent(db, {
      agreementId: AG,
      applicationId: APP,
      recipientId: null,
      consent: true,
      source: "reservation_fee",
      ip: "198.51.100.4",
      userAgent: "FeePage",
    });
    expect(db.state.applications[0].sms_consent_source).toBe("reservation_fee");
    expect(db.state.applications[0].sms_consent_page).toBe("/reservation-fee");
    expect(db.state.sms_consent_log[0].source).toBe("reservation_fee");
    expect(db.state.sms_consent_log[0].phone).toBe(PHONE);
    expect(db.state.sms_consent_log[0].wording_version).toBe(RENTAL_SMS_CONSENT_VERSION);
  });

  test("a fee ticket names the signer and rejects a tampered ticket", async () => {
    const ticket = await issueReservationFeeConsentTicket({ agreementId: AG, recipientId: REC2 });
    expect(await readReservationFeeConsentTicket(ticket)).toEqual({ agreementId: AG, recipientId: REC2 });
    expect(await readReservationFeeConsentTicket(ticket + "x")).toBeNull();
    expect(ticket).not.toContain(PHONE);
  });
});

describe("migration", () => {
  const sql = readFileSync("supabase/migrations/20261125193000_sms_consent_log.sql", "utf8");
  test("staff can read and the public cannot", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.sms_consent_log");
    expect(sql).toContain("wording text NOT NULL");
    expect(sql).toContain("wording_version text NOT NULL");
    expect(sql).toContain("source IN ('agreement_signing', 'reservation_fee')");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.sms_consent_log FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT SELECT ON public.sms_consent_log TO authenticated");
    expect(sql).toContain("GRANT ALL ON public.sms_consent_log TO service_role");
    expect(sql).toContain('USING ((SELECT private.is_staff()))');
    expect(sql).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]*TO\s+(anon|authenticated)/i);
  });
});

describe("no renter numbers in the consent modules", () => {
  test("server and UI files do not hardcode a phone number", () => {
    const files = [
      "src/lib/sms-consent.ts",
      "src/lib/sms-consent-signing.server.ts",
      "src/lib/sms-consent-signing.functions.ts",
      "src/components/esign/RentalSmsConsentField.tsx",
      "src/components/esign/SigningPanel.tsx",
      "src/routes/sign.$token.tsx",
    ];
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(src).not.toMatch(/\+1[2-9]\d{9}/);
    expect(src).toContain(TEXT);
  });
});
