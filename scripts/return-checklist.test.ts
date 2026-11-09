import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  RETURN_CHECKLIST_ENABLED,
  buildReturnChecklist,
  emptyReturnChecklist,
  etWallTimeToIso,
  returnChecklistVisible,
  type ReturnChecklistDraft,
} from "../src/lib/return-checklist";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

ok(RETURN_CHECKLIST_ENABLED === false, "the return checklist flag is off");
ok(returnChecklistVisible(RETURN_CHECKLIST_ENABLED) === false, "the checklist stays off the End Rental dialog");
ok(etWallTimeToIso("2026-10-21T14:30") === "2026-10-21T18:30:00.000Z", "a summer return time is Eastern Daylight Time");
ok(etWallTimeToIso("2026-01-15T14:30") === "2026-01-15T19:30:00.000Z", "a winter return time is Eastern Standard Time");

const vehicleId = "11111111-1111-1111-1111-111111111111";
const draft: ReturnChecklistDraft = {
  ...emptyReturnChecklist(new Date("2026-10-21T18:30:00.000Z")),
  returnedAtEt: "2026-10-21T14:30",
  odometer: "41250",
  fuelOrCharge: "half",
  keysReturned: true,
  tollsTicketsNote: "Toll on the Selmon",
  depositDecisionNeeded: true,
  depositDecisionNote: "Manager to review the scratch",
  photos: [{ bucket: "condition-media", path: `${vehicleId}/photo.jpg`, angle: "front" }],
};
draft.items = draft.items.map((item) => item.key === "body" ? { ...item, result: "damage", notes: "Scratch on the bumper" } : item);
const record = buildReturnChecklist(vehicleId, draft);
ok(record.returnedAt === "2026-10-21T18:30:00.000Z" && record.odometer === 41250 && record.fuelOrCharge === "half", "time, odometer, and fuel or charge are kept");
ok(record.keysReturned === true && record.tollsTicketsNote === "Toll on the Selmon", "keys and tolls are notes on the return");
ok(record.depositDecisionNeeded === true && record.depositDecisionNote === "Manager to review the scratch", "the deposit decision is a note");
ok(!("amount" in record) && !("refund" in record), "the checklist carries no amount and no refund");
ok(record.items.find((item) => item.key === "body")?.result === "damage", "exterior damage and its note are kept");
ok(record.photos[0].bucket === "condition-media" && !record.photos[0].path.includes("://"), "photos stay on the private condition path");

let rejected = false;
try {
  buildReturnChecklist(vehicleId, { ...draft, photos: [{ bucket: "condition-media", path: "https://cdn.example/car.jpg", angle: "front" }] });
} catch {
  rejected = true;
}
ok(rejected, "a public photo URL is refused");

const page = readFileSync("src/components/admin/BookingActions.tsx", "utf8");
const dialog = page.slice(page.indexOf("function EndRentalDialog"), page.indexOf("function HandoffDialog"));
const view = dialog.slice(dialog.indexOf("return ("));
const gateAt = view.indexOf("RETURN_CHECKLIST_ENABLED");
ok(gateAt > 0 && view.indexOf("ReturnCloseoutFields") > gateAt, "the checklist mounts only after the flag check");
ok(!view.slice(0, gateAt).includes("ReturnCloseoutFields"), "the flag-off dialog does not include the checklist");
ok(view.includes("End Date") && view.includes("Return Mileage") && view.includes("Where The Vehicle Goes") && view.includes("End Rental"), "the existing End Rental questions stay in the dialog");
const call = dialog.slice(dialog.indexOf("await close("), dialog.indexOf("})) as"));
ok(call.includes("rentalId") && call.includes("endDate") && call.includes("vehicleStatus") && call.includes("returnMileage"), "endRental still receives the same four fields");
ok(!/deposit|checklist|refund|settle/i.test(call), "the endRental call does not carry checklist or deposit fields");
ok(dialog.indexOf("if (RETURN_CHECKLIST_ENABLED)") < dialog.indexOf("await close("), "the existing end call still runs, and the checklist save is behind the flag");

const fn = readFileSync("src/lib/return-checklist.functions.ts", "utf8");
const save = fn.slice(fn.indexOf("handler(async ({ data, context })"), fn.indexOf("export const getReturnChecklist"));
ok(save.indexOf("refuseWhileOff()") < save.indexOf("await import"), "flag off returns before the database loads");
ok(save.includes("requireManager(") && !save.includes("requireStaff("), "saving a return checklist requires a manager");
ok(!fn.includes("getPublicUrl") && !fn.includes("settleDeposit") && !fn.includes("rentals.functions"), "the checklist does not publish a URL or settle a deposit");
ok(!readFileSync("src/lib/rentals.functions.ts", "utf8").includes("RETURN_CHECKLIST"), "endRental is unchanged");
ok(!readFileSync("src/components/admin/DepositDialog.tsx", "utf8").includes("RETURN_CHECKLIST"), "DepositDialog is unchanged");

const sql = readFileSync("proposed/return-checklist-v1.sql", "utf8");
ok(sql.includes("Apply after packet step 19"), "the SQL waits for packet step 19");
ok(sql.includes("condition-media") && sql.includes("storage_bucket = 'condition-media'"), "photos are constrained to the private condition bucket");
ok(!/supabase\/migrations\/[^']*return-checklist/.test(sql), "the proposal does not point at a migration path");
ok(!readdirSync("supabase/migrations").some((name) => name.includes("return-checklist")), "nothing was added under migrations");
ok(existsSync("proposed/return-checklist-v1.sql"), "the proposal lives in proposed/");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall return checklist checks pass");
process.exit(fails ? 1 : 0);
