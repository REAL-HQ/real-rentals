import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agreementBelongsToBooking,
  paymentBelongsToBooking,
  selectBookingAgreements,
} from "../src/lib/booking-links.ts";
import { linkOrphansToRental, linkAgreementToLiveRental } from "../src/lib/booking-links.server.ts";
import { applicationWasSubmitted, buildApplicationSummary } from "../src/lib/application-summary.ts";
import { rowOpenProps, shouldIgnoreRowEvent } from "../src/lib/row-click.ts";

const APP = "802fb55c-d7e8-45ae-9b40-dc5efa74753f";
const VEH = "061cb5e9-27e7-48a4-b71b-5172f31af12c";
const booking = { id: "303a7ae5", applicationId: APP, vehicleId: VEH };
const signedUnlinked = { rental_id: null, application_id: APP, vehicle_id: VEH };

describe("which agreements belong to a booking", () => {
  it("shows Jonathon's agreement signed before the rental existed (rental_id null)", () => {
    assert.equal(agreementBelongsToBooking(signedUnlinked, booking, []), true);
  });
  it("still shows a linked agreement", () => {
    assert.equal(agreementBelongsToBooking({ ...signedUnlinked, rental_id: "303a7ae5" }, booking, []), true);
  });
  it("never shows an agreement linked to another rental", () => {
    assert.equal(agreementBelongsToBooking({ ...signedUnlinked, rental_id: "other" }, booking, []), false);
  });
  it("never shows another person's unlinked agreement", () => {
    assert.equal(agreementBelongsToBooking({ ...signedUnlinked, application_id: "someone-else" }, booking, []), false);
  });
  it("with a second live rental, an unlinked agreement goes with the car it names", () => {
    const sib = [{ id: "r2", vehicleId: "veh-2", status: "active" }];
    assert.equal(agreementBelongsToBooking(signedUnlinked, booking, sib), true);
    assert.equal(agreementBelongsToBooking({ ...signedUnlinked, vehicle_id: "veh-2" }, booking, sib), false);
    assert.equal(agreementBelongsToBooking({ ...signedUnlinked, vehicle_id: null }, booking, sib), false);
  });
  it("a cancelled sibling does not hide the agreement", () => {
    const sib = [{ id: "r2", vehicleId: "veh-2", status: "cancelled" }];
    assert.equal(agreementBelongsToBooking({ ...signedUnlinked, vehicle_id: "veh-2" }, booking, sib), true);
  });
  it("switching cars keeps the agreement on the booking when it is the only rental", () => {
    assert.equal(agreementBelongsToBooking({ ...signedUnlinked, vehicle_id: "old-car" }, booking, []), true);
  });
  it("selectBookingAgreements filters a mixed list", () => {
    const rows = [signedUnlinked, { ...signedUnlinked, rental_id: "x" }, { ...signedUnlinked, rental_id: "303a7ae5" }];
    assert.equal(selectBookingAgreements(rows, booking, []).length, 2);
  });
});

describe("which payments belong to a booking", () => {
  it("the Reservation Fee paid before the rental existed shows (driver_id is the application id)", () => {
    assert.equal(paymentBelongsToBooking({ rental_id: null, driver_id: APP }, booking, []), true);
  });
  it("another person's unlinked payment does not", () => {
    assert.equal(paymentBelongsToBooking({ rental_id: null, driver_id: "x" }, booking, []), false);
  });
  it("a payment on another rental does not", () => {
    assert.equal(paymentBelongsToBooking({ rental_id: "r2", driver_id: APP }, booking, []), false);
  });
  it("with two live rentals an unlinked payment is not guessed", () => {
    assert.equal(paymentBelongsToBooking({ rental_id: null, driver_id: APP }, booking, [{ id: "r2", vehicleId: null, status: "active" }]), false);
  });
});

// A tiny recording fake of the supabase builder.
function fake(tables: Record<string, any>) {
  const calls: any[] = [];
  const admin = {
    from(t: string) {
      const q: any = { t, filters: [] as any[], patch: null as any };
      const b: any = {
        update: (p: any) => ((q.patch = p), b),
        select: () => b,
        maybeSingle: () => Promise.resolve({ data: tables[t + ":one"] ?? null }),
        then: (res: any, rej: any) => {
          if (q.patch) calls.push(q);
          return Promise.resolve({ data: q.patch ? (tables[t + ":updated"] ?? []) : (tables[t + ":list"] ?? []) }).then(res, rej);
        },
      };
      for (const k of ["eq", "is", "neq", "in"]) b[k] = (...a: any[]) => (q.filters.push([k, ...a]), b);
      return b;
    },
  };
  return { admin, calls };
}

describe("linking at creation time", () => {
  it("linkOrphansToRental stamps the rental on unlinked agreements and the fee payment", async () => {
    const { admin, calls } = fake({
      "rentals:one": { id: "R", application_id: APP, vehicle_id: VEH, status: "reserved", reservation_deposit_payment_id: "PAY" },
      "rentals:list": [],
      "agreements:updated": [{ id: "A" }],
      "payments:updated": [{ id: "PAY" }],
    });
    const r = await linkOrphansToRental(admin, "R");
    assert.deepEqual(r, { agreements: 1, payments: 1 });
    const ag = calls.find((c) => c.t === "agreements");
    assert.deepEqual(ag.patch, { rental_id: "R" });
    assert.ok(ag.filters.some((f: any[]) => f[0] === "is" && f[1] === "rental_id" && f[2] === null), "only unlinked rows");
    assert.ok(ag.filters.some((f: any[]) => f[0] === "eq" && f[1] === "application_id" && f[2] === APP));
  });
  it("never throws", async () => {
    const r = await linkOrphansToRental({ from() { throw new Error("db down"); } }, "R");
    assert.deepEqual(r, { agreements: 0, payments: 0 });
    await linkAgreementToLiveRental({ from() { throw new Error("db down"); } }, "A");
  });
});

describe("wiring", () => {
  const bookings = readFileSync("src/lib/bookings.functions.ts", "utf8");
  it("getBooking reads by rental OR same-person unlinked, then filters", () => {
    assert.match(bookings, /rental_id\.is\.null,application_id\.eq/);
    assert.match(bookings, /selectBookingAgreements[<(]/);
    assert.match(bookings, /paymentBelongsToBooking\(/);
  });
  it("reserve, fee-hold, agreement-create and activation link records to the rental", () => {
    for (const f of ["src/lib/reservations.functions.ts", "src/lib/reservation-fee.server.ts", "src/lib/rentals.functions.ts"])
      assert.match(readFileSync(f, "utf8"), /booking-links\.server/, f);
    assert.match(readFileSync("src/lib/agreements.functions.ts", "utf8"), /linkAgreementToLiveRental/);
  });
});

describe("agreement viewer", () => {
  const dlg = readFileSync("src/components/admin/AgreementViewerDialog.tsx", "utf8");
  it("shows the PDF on screen and keeps Download", () => {
    assert.match(dlg, /AgreementPdfViewer/);
    assert.match(dlg, /saveAgreementPdf/);
    assert.match(dlg, /getAgreementPdf/);
  });
  it("is used by the driver Documents card and the booking dialog", () => {
    for (const f of ["src/components/admin/AgreementsCard.tsx", "src/components/admin/BookingDetails.tsx"])
      assert.match(readFileSync(f, "utf8"), /AgreementViewerDialog/, f);
    assert.match(readFileSync("src/components/admin/AgreementsCard.tsx", "utf8"), /data-testid="view-agreement"/);
  });
});

describe("whole-row click", () => {
  const el = (inside: boolean, interactive: boolean) => ({ closest: () => (interactive ? {} : null), contains: () => inside });
  it("ignores buttons/links inside the row and portal content", () => {
    const row = { contains: () => true };
    assert.equal(shouldIgnoreRowEvent({ closest: () => ({}) }, row), true);
    assert.equal(shouldIgnoreRowEvent({ closest: () => row }, row), false);
    assert.equal(shouldIgnoreRowEvent({ closest: () => null }, row), false);
    assert.equal(shouldIgnoreRowEvent({ closest: () => null }, { contains: () => false }), true);
    void el;
  });
  it("opens on click and on Enter/Space only when the row itself has focus", () => {
    let n = 0;
    const p = rowOpenProps(() => n++);
    const row = { contains: () => true };
    p.onClick({ target: { closest: () => null }, currentTarget: row });
    assert.equal(n, 1);
    p.onClick({ target: { closest: () => ({}) }, currentTarget: row });
    assert.equal(n, 1);
    p.onKeyDown({ key: "Enter", target: row, currentTarget: row, preventDefault() {} });
    p.onKeyDown({ key: " ", target: row, currentTarget: row, preventDefault() {} });
    assert.equal(n, 3);
    p.onKeyDown({ key: "Enter", target: {}, currentTarget: row, preventDefault() {} });
    assert.equal(n, 3);
    assert.equal(p.tabIndex, 0);
  });
  it("Reserved, Active, Past, Leads and Pending Signatures rows use it", () => {
    for (const f of ["ReservationsPanel", "ActiveRentalsPanel", "BookingsPanel", "DriversPanel", "PendingSignatures"])
      assert.match(readFileSync(`src/components/admin/${f}.tsx`, "utf8"), /rowOpenProps/, f);
    const d = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    assert.equal((d.match(/<td[^>]*onClick=\{\(e\) => e\.stopPropagation\(\)\}/g) ?? []).length, 0, "no cell blocks the row click");
  });
});

describe("Documents grid: application and agreement cards", () => {
  const grid = readFileSync("src/components/admin/ApplicantDocuments.tsx", "utf8");
  it("builds the application summary from the submitted record", () => {
    const rec = { id: "802fb55c", full_name: "Jonathon Boykins", email: "j@x.com", status: "approved", created_at: "2026-11-13T17:20:00Z", license_number: "D1234567", consent_terms: true, platforms: ["Uber", "Lyft"] };
    assert.equal(applicationWasSubmitted(rec), true);
    const flat = buildApplicationSummary(rec).flatMap((s) => s.rows);
    assert.ok(flat.some((r) => r.label === "Name" && r.value === "Jonathon Boykins"));
    assert.ok(flat.some((r) => r.label === "Platforms" && r.value === "Uber, Lyft"));
    assert.ok(flat.some((r) => r.label === "License Number" && r.value === "…4567"), "licence number is last 4 only");
    assert.ok(!flat.some((r) => r.value.includes("D1234567")));
  });
  it("a draft or nameless record is not a submitted application", () => {
    assert.equal(applicationWasSubmitted({ full_name: "A", status: "draft" }), false);
    assert.equal(applicationWasSubmitted({ status: "new" }), false);
    assert.equal(applicationWasSubmitted(null), false);
  });
  it("the Rental Application card falls back to the generated application and is viewable", () => {
    assert.match(grid, /getApplicationSummary/);
    assert.match(grid, /summaryCard/);
    assert.match(grid, /data-testid="view-application"/);
  });
  it("PDF cards render a real thumbnail and the viewer renders PDF pages (no blank object)", () => {
    assert.match(grid, /<PdfThumbnail/);
    const viewer = readFileSync("src/components/admin/DocumentViewer.tsx", "utf8");
    assert.match(viewer, /AgreementPdfViewer url=/);
    assert.equal(viewer.includes("<object"), false);
  });
  it("e-signed (system) agreements show E-Signed and no manual Verify; paper ones keep Verify", () => {
    assert.match(grid, /isSystemSigned/);
    assert.match(grid, /st !== "verified" && !systemSigned/);
    assert.match(grid, /Signed Through Our E-Sign Flow/);
  });
  it("the summary is Manager-gated and never ships the full licence number", () => {
    const fn = readFileSync("src/lib/documents.functions.ts", "utf8");
    const i = fn.indexOf("export const getApplicationSummary");
    assert.match(fn.slice(i), /requireManager/);
  });
});
