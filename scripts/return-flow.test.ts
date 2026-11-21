import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  RETURN_FLOW_ENABLED,
  RETURN_STEPS,
  canSkipPhotos,
  detailsReady,
  destinationForComplete,
  finalAmountAfterDeposit,
  moneyCents,
  nextReturnStep,
  normalizeSkipReason,
  pastRentalBadge,
  photosReady,
  previewFinalAmount,
  returnVehicleIdentity,
  sumBalanceCents,
} from "../src/lib/return-flow";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

ok(RETURN_FLOW_ENABLED === true, "Return flow is on in this PR");
ok(RETURN_STEPS.map((s) => s.id).join(",") === "details,photos,balance,invoice,billing,done", "six guided steps");
ok(RETURN_STEPS.every((s) => !s.label.includes(" ")), "step titles are one word");
ok(nextReturnStep("details") === "photos" && nextReturnStep("done") === null, "step order advances and stops");
ok(detailsReady({ returnedAtEt: "2026-11-09T14:30", mileage: "50100", fuelOrCharge: "half" }), "details ready with time, miles, fuel");
ok(!detailsReady({ returnedAtEt: "bad", mileage: "50100", fuelOrCharge: "half" }), "bad time fails details");
ok(photosReady({ photoCount: 2, skipReason: null }), "photos ready when uploaded");
ok(photosReady({ photoCount: 0, skipReason: "Phone died" }), "photos ready when skipped with reason");
ok(!photosReady({ photoCount: 0, skipReason: "  " }), "blank skip reason is not enough");
ok(canSkipPhotos("No camera") && normalizeSkipReason("  x  ") === "x", "skip reason trims");
ok(destinationForComplete("needs_inspection") === "maintenance", "inspection maps to maintenance for end_rental_tx");
ok(destinationForComplete("available") === "available", "available stays available");
ok(moneyCents(35000) === "$350.00", "cents format");
ok(sumBalanceCents([{ key: "1", label: "Rent", cents: 35000, kind: "rent" }, { key: "2", label: "Late", cents: 5000, kind: "late", waived: true }]) === 35000, "waived lines do not add");
ok(finalAmountAfterDeposit({ owedCents: 40000, depositApplyCents: 10000 }) === 30000, "deposit reduces final");
ok(previewFinalAmount({ owedCents: 35000, depositApplyCents: 0, extraCharges: [{ label: "Cleaning", cents: 7500, kind: "cleaning" }] }) === 42500, "extra charges add");
ok(pastRentalBadge({ status: "closed", balanceDueCents: 0 }) === "Completed", "closed with no balance is Completed");
ok(pastRentalBadge({ status: "closed", balanceDueCents: 1200 }) === "Balance Due", "closed with balance shows Balance Due");
ok(pastRentalBadge({ status: "active", balanceDueCents: 100 }) === null, "active rentals have no past badge");

const mig = readdirSync("supabase/migrations").find((n) => n.includes("return_flow"));
ok(!!mig, "migration file exists under supabase/migrations");
const sql = readFileSync(`supabase/migrations/${mig}`, "utf8");
ok(sql.includes("DO NOT apply"), "migration warns not to apply yet");
ok(sql.includes("return_checklists") && sql.includes("balance_due_cents"), "migration has checklist and balance columns");
const endFn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.end_rental_tx"));
ok(!endFn.includes("UPDATE public.applications SET status = 'closed'"), "end_rental_tx no longer closes the application");
ok(endFn.includes("automation_enrollments"), "automations still cancel on return");

const dialog = readFileSync("src/components/admin/ReturnFlowDialog.tsx", "utf8");
ok(dialog.includes('title = "Return"') || dialog.includes(">Return<"), "dialog title is Return");
ok(dialog.includes("Confirm create invoice") && dialog.includes("Confirm cancel subscription"), "invoice and subscription need confirm");
ok(dialog.includes("Draft SMS") && dialog.includes("Draft Email"), "final message uses staff-confirmed drafts");
ok(!/sendMessage\(|quo_send|send-message/i.test(dialog), "dialog does not call a send API");
ok(dialog.includes("buy.stripe.com") === false, "no generic buy.stripe.com link");

const active = readFileSync("src/components/admin/ActiveRentalsPanel.tsx", "utf8");
ok(active.includes("ReturnFlowDialog") && active.includes(">Return<"), "Active tab row has Return");
const next = readFileSync("src/components/admin/NextStepCard.tsx", "utf8");
ok(next.includes("next-step-return") && next.includes("Return"), "Next Step shows Return when rental is active");
const nextLib = readFileSync("src/lib/next-step.ts", "utf8");
ok(nextLib.includes('label: "Return"') && nextLib.includes('kind: "return"'), "next-step model offers Return");

ok(existsSync("src/lib/return-flow.functions.ts"), "server functions file exists");
const fn = readFileSync("src/lib/return-flow.functions.ts", "utf8");
ok(fn.includes("requireManager") || fn.includes("requireReturnManager"), "Return actions require Manager+");
ok(fn.includes("end_rental_tx"), "completeReturn still uses end_rental_tx");
ok(fn.includes("cancel_at_period_end") && fn.includes("subscriptionEnded"), "billing can cancel now or at period end");
ok(fn.includes("hosted_invoice_url") && fn.includes("invoice.stripe.com"), "final invoice must be the customer hosted link");

// Return popup shows which vehicle is being returned.
const idt = returnVehicleIdentity({ year: 2015, make: "Ford", model: "Fusion", license_plate: " ec20lk ", vin: "3FA6P0HD1FR131701" });
ok(idt.title === "2015 Ford Fusion" && idt.plate === "EC20LK" && idt.vinLast6 === "131701", "identity has year/make/model, plate, last 6 of VIN");
ok(!("unit" in idt) && !JSON.stringify(idt).includes("unit"), "identity never carries a unit number");
ok(returnVehicleIdentity({}).title === "Vehicle" && returnVehicleIdentity({}).plate === "", "identity tolerates missing fields");
const dlg = readFileSync("src/components/admin/ReturnFlowDialog.tsx", "utf8");
ok(dlg.includes("return-vehicle-identity") && dlg.includes("VehiclePickerPhoto") && dlg.includes("balance.vehicleIdentity"), "dialog renders vehicle identity row with thumbnail");
ok(dlg.indexOf("return-vehicle-identity") < dlg.indexOf('step === "details" &&'), "identity row sits above the step content so it shows on every step");
ok(!dlg.slice(dlg.indexOf("return-vehicle-identity"), dlg.indexOf("return-vehicle-identity") + 1200).includes("unit_number"), "identity row never shows the unit number");
ok(fn.includes("returnVehicleIdentity(v)") && fn.includes(".eq(\"id\", data.rentalId)") && fn.includes("rental.vehicle_id"), "identity comes from the rental's current vehicle (swaps update rentals.vehicle_id)");
const swapSql = readFileSync("supabase/migrations/20261121070000_swap_insurance_optional.sql", "utf8");
ok(/SET vehicle_id = s\.to_vehicle_id/.test(swapSql), "only a completed swap changes the rental vehicle; open swaps keep the current car");
for (const f of ["DriversPanel", "ActiveRentalsPanel", "BookingActions"]) {
  ok(readFileSync(`src/components/admin/${f}.tsx`, "utf8").includes("<ReturnFlowDialog"), `${f} opens the shared Return dialog`);
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall return-flow checks pass");
process.exit(fails ? 1 : 0);
