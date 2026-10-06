// Rental Ready vs Fleet Profile. Run: bun scripts/vehicle-readiness.test.ts
import { rentalReadyItems, profileItems, notReadyMessage } from "../src/lib/vehicle-readiness";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail++; };
const minimal = { year: 2015, make: "Ford", model: "Fusion", vin: "3FA6P0HD8ER123457", weekly_rate: 375 };

ok(rentalReadyItems(minimal, 1).every((i) => i.done), "Minimal car (YMM, VIN, rate, photo) is Rental Ready with title/registration/mileage/GPS/finance/maintenance missing");
ok(rentalReadyItems({ ...minimal, weekly_rate: null }, 1).find((i) => i.key === "weekly_rate")?.done === false, "Null rate = Not Set, not ready");
ok(rentalReadyItems({ ...minimal, weekly_rate: 0 }, 1).find((i) => i.key === "weekly_rate")?.done === true, "$0 is a real value, distinct from Not Set");
ok(rentalReadyItems(minimal, 0).find((i) => i.key === "photo")?.done === false, "No photo = not ready");
ok(rentalReadyItems({ ...minimal, vin: "BAD" }, 1).find((i) => i.key === "vin")?.done === false, "Invalid VIN = not ready");
const prof = profileItems(minimal, { docKinds: [], maintenanceCount: 0 });
ok(prof.every((i) => !i.done) && rentalReadyItems(minimal, 1).every((i) => i.done), "Empty Fleet Profile never affects Rental Ready");
ok(notReadyMessage("vehicle_not_rental_ready:weekly_rate,photo") === "Not rental ready yet — add a weekly rate and at least one photo first.", "DB refusal translated");

console.log(fail ? `\n${fail} failed` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
