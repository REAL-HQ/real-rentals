/**
 * Phone layout for staff Overview and Bookings. Class checks only.
 * No database and no change to the data those screens read.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let checks = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  checks += 1;
  console.log("PASS", label);
}

const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
const bookings = readFileSync("src/components/admin/BookingsPanel.tsx", "utf8");
const details = readFileSync("src/components/admin/BookingDetails.tsx", "utf8");

check(overview.includes('className="min-w-0 space-y-6"'), "the overview root can shrink inside the admin column");
check(overview.includes("grid-cols-1 items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)]"), "the fleet chart stacks under the donut on a phone");
check(overview.includes("flex flex-wrap items-center gap-x-3 gap-y-2"), "application rows wrap the status pills");
check(overview.includes("max-w-[11rem] flex-wrap justify-end"), "the billed and collected figures wrap in the card header");
check(overview.includes("getOverviewApplicants"), "overview still reads applicants through the server function");
check(!overview.includes("text-transform"), "overview does not add a text-transform");

check(bookings.includes('aria-label="Search bookings"'), "the bookings search stays");
check(bookings.includes("w-full min-w-0 rounded-md border"), "the bookings search is a full-width field");
check(bookings.includes('data-testid="booking-phases"'), "the phase chips stay");
check(bookings.includes("hidden md:block") && bookings.includes("md:hidden grid grid-cols-1"), "the table and the phone cards both remain");
check(bookings.includes("data-booking-card") && bookings.includes("min-w-0 flex-1"), "a phone card keeps the driver name inside the row");
check(bookings.includes("flex flex-wrap items-center justify-between"), "the page controls wrap under the count");
check(bookings.includes("listBookings"), "bookings still loads through the list function");

const payments = details.slice(details.indexOf('title="Payments"'), details.indexOf("</table>") + 8);
check(payments.includes("overflow-x-auto") && payments.includes("min-w-[36rem]") && payments.includes('data-testid="booking-payments"'), "the payments table scrolls inside the booking");
check(details.includes("min-w-0 w-full max-w-5xl"), "the booking drawer cannot grow past the screen");

console.log(`${checks} overview and bookings mobile checks passed`);
