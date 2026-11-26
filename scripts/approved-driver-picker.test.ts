import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { approvedDriverMatches } from "../src/lib/approved-driver-picker.ts";

const dana = { id: "1", full_name: "Dana Rivers", email: "dana@example.com", phone: "8135550101" };
const omar = { id: "2", full_name: "Omar Vance", email: "omar@example.com", phone: "7275550199" };

describe("approved driver search", () => {
  it("matches name, email, and phone without caring about case", () => {
    assert.equal(approvedDriverMatches(dana, ""), true);
    assert.equal(approvedDriverMatches(dana, "  DANA "), true);
    assert.equal(approvedDriverMatches(dana, "rivers"), true);
    assert.equal(approvedDriverMatches(dana, "DANA@EXAMPLE"), true);
    assert.equal(approvedDriverMatches(dana, "5550101"), true);
    assert.equal(approvedDriverMatches(omar, "dana"), false);
    assert.equal(approvedDriverMatches(omar, "727"), true);
  });

  it("the reservation dialog uses the combobox, and the list includes phone", () => {
    const dlg = readFileSync("src/components/admin/ReserveCarDialog.tsx", "utf8");
    const picker = readFileSync("src/components/admin/ApprovedDriverCombobox.tsx", "utf8");
    const fn = readFileSync("src/lib/reservations.functions.ts", "utf8");
    assert.match(dlg, /ApprovedDriverCombobox/);
    assert.doesNotMatch(dlg, /AppSelect/);
    assert.match(picker, /No Matches/);
    assert.match(picker, /Search Name, Email, or Phone/);
    assert.match(picker, /role="combobox"/);
    assert.match(fn, /select\("id,full_name,email,phone,status,user_id"\)/);
  });
});
