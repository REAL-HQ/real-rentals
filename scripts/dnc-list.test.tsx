/**
 * Internal DNC List: matching, normalizers, badge, warning popup, nav, server send gates,
 * and the inventory of staff contact entry points.
 * Run: bun test scripts/dnc-list.test.tsx
 */
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Radix portals render nothing on the server; swap the alert dialog for plain markup so the
// popup's content, button order and default focus can be checked.
mock.module("@/components/ui/alert-dialog", () => {
  const pass =
    (tag: string, testid?: string) =>
    ({ children, asChild: _a, onEscapeKeyDown: _e, ...rest }: any) => {
      const Tag = tag as any;
      return (
        <Tag data-part={testid} {...rest}>
          {children}
        </Tag>
      );
    };
  return {
    AlertDialog: ({ children }: { children: ReactNode }) => <div data-part="root">{children}</div>,
    AlertDialogContent: pass("div", "content"),
    AlertDialogHeader: pass("div"),
    AlertDialogFooter: pass("div", "footer"),
    AlertDialogTitle: pass("h2"),
    AlertDialogDescription: pass("div"),
    AlertDialogCancel: pass("button", "cancel"),
    AlertDialogAction: pass("button", "action"),
  };
});

const dnc = await import("../src/lib/dnc");
const dncMessage = await import("../src/lib/dnc-message");
const { DncBadge, DncWarningDialog } = await import("../src/components/admin/DncGuard");
const { TABS, visibleTabs, navOwner, visibleWorkspaceTabs } = await import("../src/components/admin/nav-config");

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const entry = (
  over: Partial<import("../src/lib/dnc").DncIndexEntry> = {},
): import("../src/lib/dnc").DncIndexEntry => ({
  id: "e1",
  applicationId: "app-1",
  waitlistId: null,
  personType: "driver",
  personTypeLabel: "Driver",
  fullName: "Pat Sample",
  reason: "Asked not to be contacted",
  addedBy: "staff@example.com (Manager)",
  createdAt: "2026-11-27T16:00:00Z",
  removedAt: null,
  removedBy: null,
  removalReason: null,
  phones: ["5550100199"],
  emails: ["pat@example.com"],
  ...over,
});

describe("matching", () => {
  test("normalizers", () => {
    expect(dnc.normalizeDncPhone("+1 (555) 010-0199")).toBe("5550100199");
    expect(dnc.normalizeDncPhone("010-0199")).toBeNull();
    expect(dnc.normalizeDncEmail("  Pat@Example.COM ")).toBe("pat@example.com");
    expect(dnc.normalizeDncEmail("n/a")).toBeNull();
    expect(
      dnc.uniqueNormalized(["555 010 0199", "15550100199", null, "x"], dnc.normalizeDncPhone),
    ).toEqual(["5550100199"]);
  });

  test("finds by id first, then phone / email; removed entries never match", () => {
    const idx = dnc.buildDncIndex([
      entry(),
      entry({
        id: "e2",
        applicationId: null,
        waitlistId: "wl-1",
        phones: ["5550100155"],
        emails: [],
        removedAt: null,
      }),
      entry({
        id: "gone",
        applicationId: "app-9",
        phones: ["5550100111"],
        emails: [],
        removedAt: "2026-11-20T00:00:00Z",
      }),
    ]);
    expect(dnc.findDnc(idx, { applicationId: "app-1" })?.id).toBe("e1");
    expect(dnc.findDnc(idx, { waitlistId: "wl-1" })?.id).toBe("e2");
    expect(dnc.findDnc(idx, { phone: "(555) 010-0155" })?.id).toBe("e2");
    expect(dnc.findDnc(idx, { phones: [null, "555.010.0199"] })?.id).toBe("e1");
    expect(dnc.findDnc(idx, { email: "PAT@example.com" })?.id).toBe("e1");
    expect(dnc.findDnc(idx, { applicationId: "app-9", phone: "5550100111" })).toBeNull();
    expect(
      dnc.findDnc(idx, { applicationId: "app-2", phone: "5550100000", email: "x@y.z" }),
    ).toBeNull();
    expect(dnc.findDnc(null, { applicationId: "app-1" })).toBeNull();
  });

  test("tel:, sms: and mailto: links name the person; other links do not", () => {
    expect(dnc.personFromContactHref("tel:+15550100199")).toEqual({ phone: "+15550100199" });
    expect(dnc.personFromContactHref("sms:5550100199?&body=Hi")).toEqual({ phone: "5550100199" });
    expect(dnc.personFromContactHref("mailto:Pat%40Example.com,b@c.d?subject=x")).toEqual({
      emails: ["Pat@Example.com", "b@c.d"],
    });
    expect(dnc.personFromContactHref("/admin?tab=drivers")).toBeNull();
    expect(dnc.personFromContactHref("https://drivereal.com")).toBeNull();
  });

  test("person type and reason rules", () => {
    expect(dnc.dncPersonType({ source: "waitlist" })).toBe("lead");
    expect(dnc.dncPersonType({ source: "application", status: "new" })).toBe("applicant");
    expect(dnc.dncPersonType({ source: "application", status: "approved" })).toBe("driver");
    expect(
      dnc.dncPersonType({ source: "application", status: "approved", hasOpenRental: true }),
    ).toBe("renter");
    expect(dnc.dncPersonType({ source: "application", status: "active" })).toBe("renter");
    expect(dnc.dncReasonBlockers(" ")).toEqual(["Enter A Reason."]);
    expect(dnc.dncReasonBlockers("Asked to stop")).toEqual([]);
    expect(dnc.dncReasonBlockers("x".repeat(1001)).length).toBe(1);
    expect(dnc.dncMatchesSearch(entry(), "asked")).toBe(true);
    expect(dnc.dncMatchesSearch(entry(), "manager")).toBe(true);
    expect(dnc.dncMatchesSearch(entry(), "zzz")).toBe(false);
  });
});

describe("DNC badge", () => {
  test("renders in layout flow, never positioned over other info", () => {
    const html = renderToStaticMarkup(<DncBadge entry={entry()} className="ml-2" />);
    expect(html).toContain('data-testid="dnc-badge"');
    expect(html).toContain(" DNC</span>");
    expect(html).toContain("inline-flex");
    expect(html).toContain("shrink-0");
    expect(html).toContain("whitespace-nowrap");
    expect(html).not.toMatch(/\b(absolute|fixed|sticky)\b/);
    expect(html).toContain('title="On DNC List: Asked not to be contacted"');
    expect(renderToStaticMarkup(<DncBadge entry={null} />)).toBe("");
  });

  test("the badge class has no text-transform (Title Case lives in the string)", () => {
    expect(dnc.DNC_BADGE_CLASS).not.toMatch(/uppercase|capitalize/);
    expect(dnc.DNC_LABEL).toBe("DNC");
  });
});

describe("On DNC List popup", () => {
  test("shows the reason, Cancel first and focused, Contact Anyway explicit", () => {
    const html = renderToStaticMarkup(
      <DncWarningDialog
        entry={entry()}
        action="Send A Text"
        onCancel={() => {}}
        onContinue={() => {}}
      />,
    );
    expect(html).toContain("On DNC List");
    expect(html).toContain("Asked not to be contacted");
    expect(html).toContain("Pat Sample");
    expect(html).toContain("Send A Text");
    const cancel = html.indexOf('data-testid="dnc-warning-cancel"');
    const anyway = html.indexOf('data-testid="dnc-contact-anyway"');
    expect(cancel).toBeGreaterThan(-1);
    expect(anyway).toBeGreaterThan(cancel);
    expect(html).toContain("Contact Anyway");
    // React renders autoFocus as a focus call, not an attribute; check the source instead.
    expect(read("src/components/admin/DncGuard.tsx")).toMatch(/<AlertDialogCancel[^>]*autoFocus/);
  });
});

describe("navigation", () => {
  test("a DNC tab inside the Drivers workspace, visible to every staff tier", () => {
    const tab = TABS.find((t) => t.id === "dnc");
    expect(tab?.label).toBe("DNC");
    expect(tab?.group).toBeUndefined(); // no rail entry of its own
    expect(navOwner("dnc")).toBe("drivers");
    for (const tier of ["coordinator", "manager", "owner"] as const) {
      expect(visibleTabs(tier).some((t) => t.id === "dnc")).toBe(true);
      expect(visibleWorkspaceTabs("drivers", tier).map((t) => t.id)).toEqual(["drivers", "dnc"]);
    }
    const admin = read("src/routes/admin.tsx");
    expect(admin).toContain(
      'tab === "dnc" && <DncPanel canRemove={tierAllows(tier, "manager")} />',
    );
    expect(admin).toContain("<DncProvider>");
  });
});

describe("server rules", () => {
  test("Remove From DNC is Manager / Owner; Move To DNC any staff; both audited", () => {
    const fns = read("src/lib/dnc.functions.ts");
    const add = fns.slice(
      fns.indexOf("export const moveToDnc"),
      fns.indexOf("export const removeFromDncList"),
    );
    const remove = fns.slice(fns.indexOf("export const removeFromDncList"));
    expect(add).toContain("requireStaff");
    expect(remove).toContain("requireManager");
    const core = read("src/lib/dnc.server.ts");
    expect(core).toContain('action: "dnc.added"');
    expect(core).toContain('action: "dnc.removed"');
    expect(core).toContain(
      'if (TIER_RANK[actor.tier] < TIER_RANK.manager) throw new Error("Forbidden")',
    );
  });

  test("automated texts and emails skip DNC people; staff-confirmed sends pass", () => {
    const sms = read("src/lib/sms.server.ts");
    expect(sms.indexOf("1c. Internal DNC List")).toBeGreaterThan(
      sms.indexOf("1b. Blacklisted renters"),
    );
    expect(sms.indexOf("1c. Internal DNC List")).toBeLessThan(
      sms.indexOf("2. Ordinary messages require"),
    );
    expect(sms).toContain('return { ok: false, skipped: true, reason: "dnc" }');
    expect(sms).toMatch(/!inStaffContact\(\) && \(await isDncSuppressed/);
    const email = read("src/lib/email.server.ts");
    expect(email).toContain('blocked: "dnc"');
    expect(email).toMatch(/if \(!inStaffContact\(\)\)/);
  });

  test("staffContact scopes are per call", async () => {
    const { inStaffContact, staffContact } = await import("../src/lib/dnc.server");
    expect(inStaffContact()).toBe(false);
    const inside = await staffContact(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return inStaffContact();
    });
    expect(inside).toBe(true);
    expect(inStaffContact()).toBe(false);
  });

  test("isDncSuppressed: missing migration and errors let messages through; a hit suppresses", async () => {
    const { isDncSuppressed } = await import("../src/lib/dnc.server");
    const db = (res: any) => ({ rpc: async () => res });
    expect(await isDncSuppressed(db({ data: true, error: null }), { phone: "5550100199" })).toBe(
      true,
    );
    expect(await isDncSuppressed(db({ data: false, error: null }), { phone: "5550100199" })).toBe(
      false,
    );
    expect(
      await isDncSuppressed(
        db({
          data: null,
          error: { code: "PGRST202", message: "Could not find the function public.dnc_suppressed" },
        }),
        { phone: "5550100199" },
      ),
    ).toBe(false);
    expect(await isDncSuppressed(db({ data: true, error: null }), {})).toBe(false);
  });

  test("Messages: the server refuses a DNC send the popup did not confirm", () => {
    const m = read("src/lib/messages.functions.ts");
    expect(m).toContain("dncAcknowledged: z.boolean().optional()");
    expect(m).toContain("DNC_UNCONFIRMED_ERROR");
  });

  test("staff send actions run as confirmed staff contact", () => {
    const wrapped: [string, string][] = [
      ["src/lib/agreements.functions.ts", "sendAgreement"],
      ["src/lib/agreements.functions.ts", "resendAgreement"],
      ["src/lib/agreements.functions.ts", "sendStandaloneDocument"],
      ["src/lib/admin-communications.functions.ts", "requestApplicationDocuments"],
      ["src/lib/pickup-not-booked.functions.ts", "sendStaffPickupLink"],
      ["src/lib/billing-controls.functions.ts", "sendBillingPaymentMethodLink"],
      ["src/lib/vehicle-swap.functions.ts", "sendSwapVehicleAgreement"],
      ["src/lib/rental-amendment.functions.ts", "sendUpdatedAgreement"],
    ];
    for (const [file, fn] of wrapped) {
      const src = read(file);
      const at = src.indexOf(`export const ${fn} = createServerFn`);
      expect(at).toBeGreaterThan(-1);
      expect(src.slice(at, at + 300)).toContain("staffContactMiddleware");
    }
    // Bulk Notify Top skips DNC people before sending, so nobody is marked Notified without an email.
    expect(read("src/lib/waitlist.functions.ts")).toContain(
      "isDncSuppressed(supabaseAdmin, { email:",
    );
  });
});

describe("contact entry points", () => {
  // Every staff screen that contacts a person (or hands staff a link to send) asks first.
  const guarded: [string, string][] = [
    ["src/components/admin/DriversPanel.tsx", "Call Them"],
    ["src/components/admin/DriversPanel.tsx", "Email Them"],
    ["src/components/admin/DriversPanel.tsx", "Copy An Application Link To Send"],
    ["src/components/admin/DriversPanel.tsx", "Copy A Reservation Fee Link To Send"],
    ["src/components/admin/DriversPanel.tsx", "Copy A Card-On-File Link To Send"],
    ["src/components/admin/DriversPanel.tsx", "Email A Document Request"],
    ["src/components/admin/AgreementsCard.tsx", "Send The Agreement For Signature"],
    ["src/components/admin/AgreementsCard.tsx", "Resend The Signing Link"],
    ["src/components/admin/PrepareAgreementDialog.tsx", "Send The Agreement For Signature"],
    ["src/components/admin/SendDocumentDialog.tsx", "Email The Renter A Copy Of This Document"],
    ["src/components/admin/PickupLinkDialog.tsx", "Email The Pickup Link"],
    ["src/components/admin/BillingControls.tsx", "Email A Payment Method Link"],
    ["src/components/admin/BillingControls.tsx", "Copy A Payment Method Link To Send"],
    ["src/components/admin/BookingVehicleHistory.tsx", "Send The Swap Agreement For Signature"],
    ["src/components/admin/UpdatedAgreementDialog.tsx", "Send The Updated Agreement"],
    ["src/components/admin/MessagesOverlay.tsx", "Send A Text"],
  ];
  test.each(guarded)("%s asks before: %s", (file, action) => {
    const src = read(file);
    expect(src).toContain("confirmContact(");
    expect(src).toContain(action);
  });

  test("every tel:, sms: and mailto: link in the back office is caught by the provider", () => {
    const guard = read("src/components/admin/DncGuard.tsx");
    expect(guard).toContain('document.addEventListener("click", onClick, true)');
    expect(guard).toContain("personFromContactHref(href)");
  });

  test("badges on driver list, profile, leads, waitlist and messages", () => {
    expect(read("src/components/admin/DriversPanel.tsx")).toMatch(
      /<DncBadge\s+entry=\{dncLookup\(\{ applicationId: a\.id/,
    );
    expect(read("src/components/admin/DriversPanel.tsx")).toContain(
      "<DncBadge entry={dncEntry} />",
    );
    expect(read("src/components/admin/DriversPanel.tsx")).toContain("<DncCard");
    expect(read("src/components/admin/LeadPriorities.tsx")).toContain("dnc={<DncPersonBadge");
    expect(read("src/components/admin/WaitlistPanel.tsx")).toMatch(
      /<DncBadge\s+entry=\{dncLookup\(\{ waitlistId: e\.id/,
    );
    expect(read("src/components/admin/MessagesOverlay.tsx")).toContain("<DncBadge");
  });

  test("no renter phone numbers or emails in the DNC code", () => {
    for (const f of [
      "src/lib/dnc.ts",
      "src/lib/dnc.server.ts",
      "src/lib/dnc.functions.ts",
      "src/components/admin/DncGuard.tsx",
      "src/components/admin/DncControls.tsx",
      "src/components/admin/DncPanel.tsx",
      "supabase/migrations/20261127170000_internal_dnc_list.sql",
    ]) {
      expect(read(f)).not.toMatch(/\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/);
      expect(read(f)).not.toMatch(/@(gmail|yahoo|icloud|hotmail|outlook)\./i);
    }
  });

  test("every DNC name opens a profile, and the message read stays on the staff session", () => {
    const panel = read("src/components/admin/DncPanel.tsx");
    expect(panel).toContain('data-testid="dnc-open-person"');
    expect(panel).toContain("Open Profile");
    expect(panel).toContain("View Message");
    expect(panel).toContain("DNC_NO_MESSAGE_LABEL");
    expect(panel).not.toContain("e.applicationId ? (");
    const fns = read("src/lib/dnc.functions.ts");
    const messages = fns.slice(fns.indexOf("export const getDncTriggerMessages"));
    expect(messages).toContain("context.supabase");
    expect(messages).not.toContain("supabaseAdmin");
    const lookup = read("src/lib/dnc-message.server.ts");
    expect(lookup).toContain("id, application_id, waitlist_id, full_name, created_at");
    expect(lookup).not.toContain("phones, emails");
    expect(read("src/components/admin/DriversPanel.tsx")).toContain("getDriverListRow");
    expect(read("src/lib/drivers-list.functions.ts")).toContain("driverProfileId");
  });
});

describe("trigger message", () => {
  const { pickDncTrigger, DNC_TRIGGER_LABEL, dncE164, isInboundMessageKind } = dncMessage;

  test("uses the latest inbound on or before Added, and the outbound it answered", () => {
    const hit = pickDncTrigger(
      "2026-11-27T18:11:00Z",
      "Pattie Example",
      [
        { id: "later", channel: "sms", body: "After the list", at: "2026-11-27T19:00:00Z" },
        { id: "text", channel: "sms", body: "Please stop texting me", at: "2026-11-27T16:04:00Z" },
        { id: "older", channel: "email", body: "Earlier note", at: "2026-11-20T12:00:00Z" },
      ],
      [
        { id: "email-out", channel: "email", body: "An older email", at: "2026-11-27T15:00:00Z" },
        { id: "promo", channel: "sms", body: "A car is ready this week", at: "2026-11-27T15:40:00Z" },
        { id: "after-reply", channel: "sms", body: "Sent after the reply", at: "2026-11-27T16:30:00Z" },
      ],
    );
    expect(hit?.id).toBe("text");
    expect(hit?.inferred).toBe(true);
    expect(hit?.label).toBe(DNC_TRIGGER_LABEL);
    expect(hit?.sender).toBe("Pattie Example");
    expect(hit?.repliedTo?.body).toBe("A car is ready this week");
    expect(hit?.repliedTo?.channel).toBe("sms");
  });

  test("falls back to another channel when nothing on the same channel came first", () => {
    const hit = pickDncTrigger(
      "2026-11-27T18:00:00Z",
      "Pat",
      [{ id: "in", channel: "sms", body: "Stop", at: "2026-11-27T16:00:00Z" }],
      [{ id: "mail", channel: "email", body: "Hello from email", at: "2026-11-27T12:00:00Z" }],
    );
    expect(hit?.repliedTo?.body).toBe("Hello from email");
  });

  test("an inbound after Added, or no inbound at all, is not a trigger", () => {
    expect(
      pickDncTrigger(
        "2026-11-27T18:00:00Z",
        "Pat",
        [{ id: "later", channel: "sms", body: "Too late", at: "2026-11-27T18:00:01Z" }],
        [],
      ),
    ).toBeNull();
    expect(pickDncTrigger("2026-11-27T18:00:00Z", "Pat", [], [])).toBeNull();
    expect(pickDncTrigger(null, "Pat", [{ id: "x", channel: "sms", body: "Hi", at: "2026-11-27T18:00:00Z" }], [])).toBeNull();
  });

  test("a message timestamped exactly at Added still counts", () => {
    const at = "2026-11-27T18:11:00Z";
    expect(pickDncTrigger(at, "Pat", [{ id: "same", channel: "email", body: "  ", at }], [])?.body).toBe(
      "Empty Message",
    );
  });

  test("phone helper and inbound kind", () => {
    expect(dncE164("+1 (813) 555-0100")).toBe("+18135550100");
    expect(dncE164("555-0100")).toBeNull();
    expect(isInboundMessageKind("inbound_other")).toBe(true);
    expect(isInboundMessageKind("staff_message")).toBe(false);
  });
});

describe("profile id", () => {
  test("a duplicate opens the surviving application; a deleted row opens nothing", async () => {
    const { driverProfileId } = await import("../src/lib/drivers-list");
    expect(driverProfileId({ id: "app", status: "new", deleted_at: null, primary_application_id: null })).toBe("app");
    expect(driverProfileId({ id: "dup", status: "duplicate", deleted_at: null, primary_application_id: "app" })).toBe("app");
    expect(driverProfileId({ id: "gone", status: "new", deleted_at: "2026-11-01T00:00:00Z", primary_application_id: null })).toBeNull();
    expect(driverProfileId(null)).toBeNull();
  });
});
