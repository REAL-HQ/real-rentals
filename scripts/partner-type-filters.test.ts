/**
 * Partners chips are All, Lender, and JV Partner.
 * Run: bun test scripts/partner-type-filters.test.ts
 *
 * Lender counts private_lender and capital_partner. vehicle_owner (the type
 * Legacy Convert To Partner still inserts) and other stay on All.
 */
import { mock } from "bun:test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import * as realRouter from "@tanstack/react-router";
import * as realStart from "@tanstack/react-start";
import type { Partner } from "../src/components/admin/types";
import { TABS } from "../src/components/admin/nav-config";

mock.module("@tanstack/react-router", () => ({
  ...realRouter,
  useNavigate: () => () => {},
  Link: ({ children, className }: { children?: ReactNode; className?: string }) =>
    createElement("a", { className }, children),
}));
mock.module("@tanstack/react-start", () => ({
  ...realStart,
  useServerFn: () => async () => ({}),
}));
mock.module("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) },
}));

const {
  PartnersPanel,
  partnerFormChoices,
  partnerTypeToStore,
  partnerMatchesFilter,
  PARTNER_FORM_TYPES,
} = await import("../src/components/admin/PartnersPanel.tsx");

const fixtures = [
  partner({ id: "dana", name: "Dana Hale", partner_type: "vehicle_owner", email: "dana.hale@example.com" }),
  partner({ id: "ada", name: "Ada Okonkwo", partner_type: "capital_partner", email: "ada.okonkwo@example.com" }),
  partner({ id: "ben", name: "Ben Cho", partner_type: "private_lender", email: "ben.cho@example.com" }),
  partner({ id: "casey", name: "Casey Nguyen", partner_type: "jv_partner", email: "casey.nguyen@example.com" }),
  partner({ id: "evan", name: "Evan Brooks", partner_type: "other", email: "evan.brooks@example.com" }),
];

describe("partner type filters", () => {
  it("groups private lender and capital partner under Lender, and leaves other types on All", () => {
    const html = render(fixtures);
    const chips = chipRow(html);
    assert.match(chips, />All</);
    assert.match(chips, />Lender \(2\)</);
    assert.match(chips, />JV Partner \(1\)</);
    assert.doesNotMatch(chips, /Vehicle Owner|Capital Partner|Private Lender|>Other</);
    assert.match(chips, /bg-black text-white/);
    assert.match(chips, /bg-white border border-border/);
    assert.doesNotMatch(chips, /gradient|border-l-/);

    assert.match(html, /Dana Hale/);
    assert.match(html, /Ada Okonkwo/);
    assert.match(html, /Ben Cho/);
    assert.match(html, /Casey Nguyen/);
    assert.match(html, /Evan Brooks/);
    assert.match(html, /· Vehicle Owner/);
    assert.match(html, /· Capital Partner/);
    assert.match(html, /· Private Lender/);
    assert.match(html, /· JV Partner/);
    assert.match(html, /· Other/);

    const lenders = render(fixtures, "lender");
    assert.match(lenders, /Ada Okonkwo/);
    assert.match(lenders, /Ben Cho/);
    assert.doesNotMatch(lenders, /Dana Hale|Casey Nguyen|Evan Brooks/);
    assert.match(chipRow(lenders), />Lender \(2\)</);

    const jv = render(fixtures, "jv_partner");
    assert.match(jv, /Casey Nguyen/);
    assert.doesNotMatch(jv, /Dana Hale|Ada Okonkwo|Ben Cho|Evan Brooks/);
    assert.match(chipRow(jv), />JV Partner \(1\)</);
    assert.match(chipRow(jv), />Lender \(2\)</);
  });

  it("keeps a converted vehicle owner on All and does not rewrite lender rows", () => {
    assert.equal(partnerMatchesFilter("vehicle_owner", "all"), true);
    assert.equal(partnerMatchesFilter("vehicle_owner", "lender"), false);
    assert.equal(partnerMatchesFilter("vehicle_owner", "jv_partner"), false);
    assert.equal(partnerMatchesFilter("other", "all"), true);
    assert.equal(partnerMatchesFilter("other", "lender"), false);
    assert.equal(partnerMatchesFilter("capital_partner", "lender"), true);
    assert.equal(partnerMatchesFilter("private_lender", "lender"), true);
    assert.equal(partnerMatchesFilter("jv_partner", "jv_partner"), true);
    assert.equal(partnerMatchesFilter("mystery_type", "all"), true);
    assert.equal(partnerMatchesFilter("mystery_type", "lender"), false);

    assert.deepEqual(partnerFormChoices("private_lender").map((c) => c.label), ["Lender", "JV Partner"]);
    assert.deepEqual(partnerFormChoices("capital_partner").map((c) => c.label), ["Lender", "JV Partner"]);
    assert.deepEqual(partnerFormChoices("jv_partner").map((c) => c.label), ["Lender", "JV Partner"]);
    assert.deepEqual(partnerFormChoices("vehicle_owner").map((c) => c.label), ["Vehicle Owner", "Lender", "JV Partner"]);
    assert.deepEqual(partnerFormChoices("other").map((c) => c.label), ["Other", "Lender", "JV Partner"]);
    assert.deepEqual(partnerFormChoices("mystery_type").map((c) => c.value), ["mystery_type", "lender", "jv_partner"]);

    assert.equal(partnerTypeToStore("lender", "capital_partner"), null);
    assert.equal(partnerTypeToStore("lender", "private_lender"), null);
    assert.equal(partnerTypeToStore("lender", "vehicle_owner"), "private_lender");
    assert.equal(partnerTypeToStore("lender", "other"), "private_lender");
    assert.equal(partnerTypeToStore("jv_partner", "capital_partner"), "jv_partner");
    assert.equal(partnerTypeToStore("jv_partner", "jv_partner"), null);
    assert.equal(partnerTypeToStore("vehicle_owner", "vehicle_owner"), null);
    assert.equal(PARTNER_FORM_TYPES.find((c) => c.value === "lender")?.stored, "private_lender");
    assert.equal(PARTNER_FORM_TYPES.find((c) => c.value === "jv_partner")?.stored, "jv_partner");

    const src = readFileSync("src/components/admin/PartnersPanel.tsx", "utf8");
    assert.match(src, /partner_type: "vehicle_owner", status: "prospect"/);
    assert.match(src, /partner_type: "capital_partner", status: "prospect"/);
    assert.match(src, /partner_type: "private_lender", status: "prospect"/);
    assert.equal(TABS.find((t) => t.id === "partners")?.label, "Partners");
    assert.equal(TABS.find((t) => t.id === "partners")?.description, "Lenders And JV Partners");
  });
});

function render(rows: Partner[], filter?: string) {
  return renderToStaticMarkup(createElement(PartnersPanel, {
    preview: { partners: rows, filter, owners: [], investors: [] },
  }));
}

function chipRow(html: string) {
  const start = html.indexOf('data-testid="partner-type-filters"');
  assert.notEqual(start, -1);
  const end = html.indexOf("</div>", start);
  return html.slice(start, end);
}

function partner(partial: Pick<Partner, "id" | "name" | "partner_type"> & Partial<Partner>): Partner {
  return {
    email: null,
    phone: null,
    status: "prospect",
    capital_committed: 0,
    vehicles_contributed: 0,
    monthly_payment: 0,
    notes: null,
    documents: null,
    created_at: "2026-11-20T15:00:00.000Z",
    updated_at: "2026-11-20T15:00:00.000Z",
    revenue_split_pct: 50,
    user_id: null,
    ...partial,
  };
}
