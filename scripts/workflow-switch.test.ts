/**
 * Automations: each workflow card has one On/Off switch instead of a
 * Pause / Turn On button. Server-rendered switch plus source checks.
 * No browser, no database, nothing is sent.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowSwitch } from "../src/components/admin/WorkflowSwitch";

const panel = readFileSync("src/components/admin/AutomationsPanel.tsx", "utf8");
const render = (on: boolean, busy = false) =>
  renderToStaticMarkup(
    h(WorkflowSwitch, { name: "New Applicant Follow-Up", on, busy, onChange: () => {} }),
  );

describe("WorkflowSwitch", () => {
  test("is an accessible switch that reports On", () => {
    const html = render(true);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="New Applicant Follow-Up: On"');
    expect(html).toContain(">On<");
    expect(html).toContain("bg-[#D03020]");
  });
  test("reports Off with a solid grey track", () => {
    const html = render(false);
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain(">Off<");
    expect(html).toContain("bg-[#C4C4CB]");
    expect(html).not.toContain("bg-[#D03020]");
  });
  test("is disabled while saving", () => {
    expect(render(true, true)).toContain("disabled");
  });
});

describe("AutomationsPanel", () => {
  test("no longer renders a Pause / Turn On button", () => {
    expect(panel).not.toMatch(/"Pause"/);
    expect(panel).not.toContain("toggleActive");
    expect(panel).toContain("<WorkflowSwitch");
  });
  test("keeps the delete icon", () => {
    expect(panel).toContain('title="Delete Automation"');
  });
  test("turning On asks first, turning Off is immediate", () => {
    expect(panel).toContain("AlertDialog");
    expect(panel).toMatch(/if \(!next\) return void setActive\(wf, false\)/);
    expect(panel).toContain("setConfirmOn(wf)");
    expect(panel).not.toMatch(/window\.confirm\(`Turn on/);
  });
  test("the switch shows the real engine flag, is_active", () => {
    expect(panel).toMatch(/on=\{wf\.is_active\}/);
    expect(panel).toMatch(/update\(\{ is_active: next \}\)/);
  });
});
