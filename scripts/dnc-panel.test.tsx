/**
 * Renders the real DNC table and the applicant profile it opens.
 * Fixture names only. Run: bun test scripts/dnc-panel.test.tsx
 * WRITE_DNC_HTML=1 writes the three screenshot pages to /tmp/dnc-fixture.
 */
import { mock } from "bun:test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import * as realRouter from "@tanstack/react-router";
import * as realStart from "@tanstack/react-start";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Application } from "../src/components/admin/types";
import type { DncEntry } from "../src/lib/dnc";
import { DNC_NO_MESSAGE_LABEL, DNC_TRIGGER_LABEL, type DncTriggerMessage } from "../src/lib/dnc-message";

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

const { DncPanel } = await import("../src/components/admin/DncPanel.tsx");
const { DriversPanel } = await import("../src/components/admin/DriversPanel.tsx");

const APPLICANT = "aaaaaaaa-0000-4000-8000-000000000001";
const WITH_MESSAGE = "bbbbbbbb-0000-4000-8000-000000000002";
const NO_MESSAGE = "cccccccc-0000-4000-8000-000000000003";

const reason =
  "Asked not to be contacted after replying negatively to a promo text on Nov 27, 2026. Dolmar requested DNC (moved over from the text STOP list).";

function entry(id: string, name: string, applicationId: string | null): DncEntry {
  return {
    id,
    applicationId,
    waitlistId: null,
    personType: "applicant",
    personTypeLabel: "Applicant",
    fullName: name,
    reason,
    addedBy: "Dolmar",
    createdAt: "2026-11-27T18:11:00Z",
    removedAt: null,
    removedBy: null,
    removalReason: null,
  };
}

const message: DncTriggerMessage = {
  inferred: true,
  label: DNC_TRIGGER_LABEL,
  id: "messages:fixture",
  channel: "sms",
  body: "Please stop texting me. I am not interested.",
  sender: "Pattie Maupin-Phillips",
  at: "2026-11-27T16:04:00Z",
  repliedTo: {
    channel: "sms",
    body: "A car is ready this week if you still want one.",
    at: "2026-11-27T15:40:00Z",
  },
};

const entries = [
  entry(WITH_MESSAGE, "Pattie Maupin-Phillips", APPLICANT),
  entry(NO_MESSAGE, "Casey No-Reply", null),
];

function table(openMessageId?: string) {
  return renderToStaticMarkup(
    createElement(DncPanel, {
      canRemove: true,
      preview: {
        entries,
        messages: { [WITH_MESSAGE]: message, [NO_MESSAGE]: null },
        openMessageId: openMessageId ?? null,
      },
    }),
  );
}

function applicant(): Application {
  return {
    id: APPLICANT,
    full_name: "Pattie Maupin-Phillips",
    email: "pattie.example@example.com",
    phone: "+18135550100",
    status: "new",
    contact_status: "new",
    vehicle_id: null,
    created_at: "2026-11-01T15:00:00Z",
    city: "Tampa",
    state: "FL",
    reviewed_at: "2026-11-02T15:00:00Z",
  } as Application;
}

function profile() {
  const client = new QueryClient();
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(DriversPanel, {
        isManager: true,
        canManageWaitlist: true,
        previewDrivers: [applicant()],
        initialOpenId: APPLICANT,
      }),
    ),
  );
}

describe("DNC names and messages", () => {
  it("makes an applicant name a button and shows the message or No Message Found", () => {
    const html = table();
    assert.match(html, /data-testid="dnc-open-person"[^>]*>Pattie Maupin-Phillips/);
    assert.match(html, /data-testid="dnc-open-person"[^>]*>Casey No-Reply/);
    assert.match(html, /Applicant/);
    assert.match(html, /Please stop texting me/);
    assert.match(html, new RegExp(DNC_TRIGGER_LABEL));
    assert.match(html, new RegExp(DNC_NO_MESSAGE_LABEL));
    assert.match(html, /View Message/);
    assert.match(html, /Remove From DNC/);
    assert.equal((html.match(/data-testid="dnc-view-message"/g) ?? []).length, 1);
  });

  it("opens the triggering message with the outbound it replied to", () => {
    const html = table(WITH_MESSAGE);
    assert.match(html, /aria-label="View Message"/);
    assert.match(html, /Most Recent Inbound On Or Before Added/);
    assert.match(html, /Please stop texting me\. I am not interested\./);
    assert.match(html, /A car is ready this week if you still want one\./);
    assert.match(html, /Replied To/);
    assert.match(html, />Sender</);
    assert.match(html, />Text</);
  });

  it("opens the existing applicant profile from the Drivers panel", () => {
    const html = profile();
    assert.match(html, /data-testid="driver-profile"/);
    assert.match(html, /Pattie Maupin-Phillips/);
    assert.doesNotMatch(html, /data-testid="driver-profile-missing"/);
  });
});

if (process.env.WRITE_DNC_HTML === "1") {
  const dir = "/tmp/dnc-fixture";
  mkdirSync(dir, { recursive: true });
  const wrap = (title: string, body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body class="bg-[#F6F6F7]"><main class="mx-auto max-w-6xl p-6"><h1 class="mb-4 text-lg font-semibold">${title}</h1>${body}</main></body></html>`;
  writeFileSync(`${dir}/table.html`, wrap("Do Not Contact", table()));
  writeFileSync(`${dir}/message.html`, wrap("Do Not Contact", table(WITH_MESSAGE)));
  writeFileSync(`${dir}/profile.html`, wrap("Applicant Profile", profile()));
  console.log(dir);
}
