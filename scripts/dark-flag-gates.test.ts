// Each dark flag refuses before requireSupabaseAuth.
// A request with no Authorization header must throw the feature error,
// not "Unauthorized: No authorization header provided".
// Run: bun test scripts/dark-flag-gates.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestHandler } from "@tanstack/react-start/server";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { getRentalCloseoutPreview } from "../src/lib/closeout-preview.functions.ts";
import { listIncidentChargePrep } from "../src/lib/incident-charge-prep.functions.ts";
import { listMaintenanceDueSchedule } from "../src/lib/maintenance-due-schedule.functions.ts";
import { listMaintenanceDue } from "../src/lib/maintenance-due.functions.ts";
import {
  linkReplacementAgreement,
  loadReplacementAgreement,
  previewReplacementAgreement,
  sendReplacementAgreement,
} from "../src/lib/replacement-agreement.functions.ts";
import { swapRentalVehicle } from "../src/lib/vehicle-swap.functions.ts";
import { listStalledApplications } from "../src/lib/stalled-applications.functions.ts";
import {
  applyBillingDay,
  createBillingPaymentMethodLink,
  grantBillingExtension,
  previewBillingDay,
  sendBillingPaymentMethodLink,
  setBillingSubscriptionDefault,
  verifyBillingPaymentMethod,
} from "../src/lib/billing-controls.functions.ts";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";

type ServerFn = {
  __executeServer: (opts: { data?: unknown }) => Promise<{ error?: unknown }>;
};

const AUTH_REFUSAL = "Unauthorized: No authorization header provided";

async function refuseWithoutAuth(fn: ServerFn): Promise<Error> {
  let caught: unknown;
  const handle = requestHandler(async () => {
    try {
      await runWithStartContext({} as never, async () => {
        const result = await fn.__executeServer({});
        if (result.error) throw result.error;
      });
    } catch (error) {
      caught = error;
    }
    return new Response(null, { status: 204 });
  });
  const response = await handle(
    new Request("http://127.0.0.1/rpc", { method: "POST" }),
  );
  assert.equal(response.status, 204);
  assert.ok(caught instanceof Error, `expected an error, got ${String(caught)}`);
  return caught;
}

const cases: Array<{ name: string; fn: ServerFn; message: string }> = [
  { name: "closeout preview", fn: getRentalCloseoutPreview as unknown as ServerFn, message: "Closeout Preview is off" },
  { name: "incident charge prep", fn: listIncidentChargePrep as unknown as ServerFn, message: "Incident Charge Prep is off" },
  { name: "maintenance due schedule", fn: listMaintenanceDueSchedule as unknown as ServerFn, message: "Maintenance Due is off" },
  {
    name: "maintenance due",
    fn: listMaintenanceDue as unknown as ServerFn,
    message: "Maintenance Due is disabled pending installation and acceptance",
  },
  {
    name: "replacement preview",
    fn: previewReplacementAgreement as unknown as ServerFn,
    message: "Replacement agreement is disabled pending installation and acceptance",
  },
  {
    name: "replacement load",
    fn: loadReplacementAgreement as unknown as ServerFn,
    message: "Replacement agreement is disabled pending installation and acceptance",
  },
  {
    name: "replacement send",
    fn: sendReplacementAgreement as unknown as ServerFn,
    message: "Replacement agreement is disabled pending installation and acceptance",
  },
  {
    name: "replacement link",
    fn: linkReplacementAgreement as unknown as ServerFn,
    message: "Replacement agreement is disabled pending installation and acceptance",
  },
  {
    name: "vehicle swap",
    fn: swapRentalVehicle as unknown as ServerFn,
    message: "Vehicle swap is disabled pending installation and acceptance",
  },
  {
    name: "stalled applications",
    fn: listStalledApplications as unknown as ServerFn,
    message: "Stalled applications are not enabled.",
  },
  {
    name: "payment method link",
    fn: createBillingPaymentMethodLink as unknown as ServerFn,
    message: "Payment method update links are off.",
  },
  {
    name: "payment method send",
    fn: sendBillingPaymentMethodLink as unknown as ServerFn,
    message: "Payment method update links are off.",
  },
  {
    name: "payment method verify",
    fn: verifyBillingPaymentMethod as unknown as ServerFn,
    message: "Payment method update links are off.",
  },
  {
    name: "subscription default",
    fn: setBillingSubscriptionDefault as unknown as ServerFn,
    message: "Payment method update links are off.",
  },
  {
    name: "billing day preview",
    fn: previewBillingDay as unknown as ServerFn,
    message: "Billing day changes are off.",
  },
  {
    name: "billing day apply",
    fn: applyBillingDay as unknown as ServerFn,
    message: "Billing day changes are off.",
  },
  {
    name: "payment extension",
    fn: grantBillingExtension as unknown as ServerFn,
    message: "Payment extensions are off.",
  },
];

describe("dark flags refuse with no auth header", () => {
  for (const item of cases) {
    it(item.name, async () => {
      const error = await refuseWithoutAuth(item.fn);
      assert.equal(error.message, item.message);
      assert.equal(error.message === AUTH_REFUSAL, false);
    });
  }
});
