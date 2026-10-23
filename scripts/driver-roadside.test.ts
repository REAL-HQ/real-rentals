import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DRIVER_ROADSIDE_ENABLED,
  ROADSIDE_CHECKLIST,
  ROADSIDE_EMAIL,
  ROADSIDE_PHONE,
  ROADSIDE_SECTIONS,
  roadsideHelpHref,
} from "../src/lib/driver-roadside";
import { myCarLinks } from "../src/lib/my-car-card";

describe("driver roadside flag", () => {
  it("is off", () => {
    assert.equal(DRIVER_ROADSIDE_ENABLED, false);
    assert.equal(roadsideHelpHref(), null);
    assert.equal(roadsideHelpHref(true), "/portal/roadside");
  });

  it("redirects /portal/roadside before the page, and shows no link while the flag is off", () => {
    const route = readFileSync("src/routes/portal_.roadside.tsx", "utf8");
    const guard = route.indexOf("DRIVER_ROADSIDE_ENABLED");
    const bounce = route.indexOf("redirect(");
    const component = route.indexOf("component:");
    assert.ok(guard !== -1 && bounce !== -1 && guard < bounce && bounce < component);
    assert.match(route, /to: "\/portal"/);
    assert.doesNotMatch(route, /supabase|useQuery|\.from\(|stripe|<form/);

    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    assert.doesNotMatch(portal, /\/portal\/roadside|DriverRoadside/);
    assert.match(portal, /MY_CAR_CARD_ENABLED \? <MyCarGate/);

    const page = readFileSync("src/components/portal/DriverRoadside.tsx", "utf8");
    const lib = readFileSync("src/lib/driver-roadside.ts", "utf8");
    const card = readFileSync("src/components/portal/MyCarCard.tsx", "utf8");
    assert.match(page, /min-h-12/);
    assert.match(page, /tel:911|ROADSIDE_EMERGENCY_TEL/);
    assert.match(page, /Call 911/);
    assert.match(card, /to="\/portal\/roadside"/);
    assert.match(card, /link\.href === "\/portal\/roadside"/);
    assert.doesNotMatch(`${page}\n${lib}`, /supabase|useQuery|useServerFn|\.from\(|stripe|\.insert\(|\.update\(|\.delete\(|<form/);
  });
});

describe("driver roadside copy", () => {
  it("uses agreement sentences and the incident names, with no amounts", () => {
    assert.deepEqual(
      ROADSIDE_SECTIONS.map((section) => section.title),
      ["After An Accident", "Breakdown", "Flat Tire", "Lockout", "Ticket Or Toll"],
    );
    assert.equal(ROADSIDE_SECTIONS[0]?.category, "Accident");
    assert.equal(ROADSIDE_SECTIONS[1]?.category, "Breakdown");
    const stated = ROADSIDE_SECTIONS.flatMap((section) => section.stated).join("\n");
    assert.match(stated, /call 911 if anyone is hurt/);
    assert.match(stated, /photograph the scene and the other driver's license and insurance/);
    assert.match(stated, /Stop driving if continuing could cause further damage/);
    assert.match(stated, /without our approval/);
    assert.match(stated, /Flat or damaged tires/);
    assert.match(stated, /lockout service calls are charged as listed in the Fee Schedule/);
    assert.match(stated, /tolls, tickets, camera citations, and violations/);
    assert.equal(ROADSIDE_PHONE, "(888) 833-8280");
    assert.equal(ROADSIDE_EMAIL, "team@drivereal.com");
    assert.ok(stated.includes(ROADSIDE_PHONE));
    assert.ok(stated.includes(ROADSIDE_EMAIL));
    assert.doesNotMatch(stated, /\$|3\.5%|\[24\]|\[75\]/);
    assert.deepEqual(ROADSIDE_CHECKLIST, [
      "Photos of the scene, and of the other driver's license and insurance.",
      "The other driver's info: name, insurer, and plate.",
      "A police report number.",
    ]);
  });

  it("leaves the open fee and deadline items for Dolmar", () => {
    const todos = Object.fromEntries(ROADSIDE_SECTIONS.map((section) => [section.title, section.todo]));
    assert.match(todos["After An Accident"] ?? "", /report_hours/);
    assert.match(todos["Breakdown"] ?? "", /report_hours/);
    assert.match(todos["Flat Tire"] ?? "", /no amount is shown/);
    assert.match(todos["Lockout"] ?? "", /locksmith/);
    assert.match(todos["Ticket Or Toll"] ?? "", /no added fee/);
  });

  it("points the My Car card at this page only when both flags are on", () => {
    assert.equal(myCarLinks(false)[2]?.href, null);
    assert.equal(myCarLinks(true)[2]?.href, "/portal/roadside");
    assert.equal(myCarLinks(true)[2]?.label, "Roadside Help");
  });
});
