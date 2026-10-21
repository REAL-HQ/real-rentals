// Renter lifecycle notices. No network, no Twilio, no Resend.
// Run: node --import tsx --test scripts/renter-lifecycle-notices.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import {
  enrollRenterLifecycleNotice,
  renterLifecycleNoticesEnabled,
  type RenterLifecycleEvent,
} from "../src/lib/renter-lifecycle-notices.server";

const FLAG = "RENTER_LIFECYCLE_NOTICES_ENABLED";
const prior = process.env[FLAG];

afterEach(() => {
  if (prior === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prior;
});

function enable() {
  process.env[FLAG] = "true";
}

describe("flag", () => {
  it("is on only for the exact string true", () => {
    for (const value of [undefined, "", "false", "TRUE", "1", "yes"]) {
      if (value === undefined) delete process.env[FLAG];
      else process.env[FLAG] = value;
      assert.equal(renterLifecycleNoticesEnabled(), false, `value ${String(value)}`);
    }
    enable();
    assert.equal(renterLifecycleNoticesEnabled(), true);
  });
});

describe("enrollRenterLifecycleNotice", () => {
  it("does not enroll or load the renter when the flag is off", async () => {
    delete process.env[FLAG];
    let calls = 0;
    const result = await enrollRenterLifecycleNotice(
      { event: "rental_started", applicationId: "app-1", rentalId: "rent-1" },
      {
        enroll: async () => {
          calls++;
          return { enrolled: 1 };
        },
        loadApplicationId: async () => {
          throw new Error("lookup");
        },
      },
    );
    assert.deepEqual(result, { enrolled: 0, skipped: "flag" });
    assert.equal(calls, 0);
  });

  it("enrolls rental_started, rental_ended, and incident_logged through the given sender", async () => {
    enable();
    const seen: RenterLifecycleEvent[] = [];
    const enroll = async (args: { trigger: RenterLifecycleEvent; applicationId: string | null; rentalId: string | null }) => {
      seen.push(args.trigger);
      assert.equal(args.applicationId, "app-1");
      assert.equal(args.rentalId, "rent-1");
      return { enrolled: 1 };
    };
    for (const event of ["rental_started", "rental_ended", "incident_logged"] as const) {
      const result = await enrollRenterLifecycleNotice(
        { event, applicationId: "app-1", rentalId: "rent-1" },
        { enroll },
      );
      assert.deepEqual(result, { enrolled: 1, skipped: null });
    }
    assert.deepEqual(seen, ["rental_started", "rental_ended", "incident_logged"]);
  });

  it("skips an incident that is an edit or has no rental", async () => {
    enable();
    let calls = 0;
    const enroll = async () => {
      calls++;
      return { enrolled: 1 };
    };
    const edited = await enrollRenterLifecycleNotice(
      { event: "incident_logged", applicationId: "app-1", rentalId: "rent-1", fresh: false },
      { enroll },
    );
    const unattributed = await enrollRenterLifecycleNotice(
      { event: "incident_logged", applicationId: "app-1", rentalId: null },
      { enroll },
    );
    assert.equal(edited.skipped, "not_fresh");
    assert.equal(unattributed.skipped, "no_renter");
    assert.equal(calls, 0);
  });

  it("skips a closeout that was already closed", async () => {
    enable();
    const result = await enrollRenterLifecycleNotice(
      { event: "rental_ended", rentalId: "rent-1", fresh: false },
      { enroll: async () => ({ enrolled: 1 }) },
    );
    assert.deepEqual(result, { enrolled: 0, skipped: "not_fresh" });
  });

  it("loads the application from the rental only when the flag is on and the id was not passed", async () => {
    enable();
    let loaded = 0;
    const result = await enrollRenterLifecycleNotice(
      { event: "rental_ended", rentalId: "rent-1" },
      {
        loadApplicationId: async (rentalId) => {
          loaded++;
          assert.equal(rentalId, "rent-1");
          return "app-from-rental";
        },
        enroll: async (args) => {
          assert.equal(args.applicationId, "app-from-rental");
          return { enrolled: 1 };
        },
      },
    );
    assert.equal(loaded, 1);
    assert.equal(result.enrolled, 1);

    loaded = 0;
    await enrollRenterLifecycleNotice(
      { event: "rental_started", applicationId: "app-1", rentalId: "rent-1" },
      {
        loadApplicationId: async () => {
          loaded++;
          return "other";
        },
        enroll: async () => ({ enrolled: 1 }),
      },
    );
    assert.equal(loaded, 0);
  });

  it("swallows enroll and lookup failures", async () => {
    enable();
    const failedSend = await enrollRenterLifecycleNotice(
      { event: "rental_started", applicationId: "app-1", rentalId: "rent-1" },
      {
        enroll: async () => {
          throw new Error("transport down");
        },
      },
    );
    const failedLookup = await enrollRenterLifecycleNotice(
      { event: "rental_ended", rentalId: "rent-1" },
      {
        loadApplicationId: async () => {
          throw new Error("db down");
        },
      },
    );
    assert.equal(failedSend.skipped, "error");
    assert.equal(failedLookup.skipped, "error");
    assert.equal(failedSend.enrolled, 0);
  });

  it("does not enroll when the rental has no application", async () => {
    enable();
    let calls = 0;
    const result = await enrollRenterLifecycleNotice(
      { event: "rental_ended", rentalId: "rent-1" },
      {
        loadApplicationId: async () => null,
        enroll: async () => {
          calls++;
          return { enrolled: 1 };
        },
      },
    );
    assert.equal(result.skipped, "no_renter");
    assert.equal(calls, 0);
  });
});

describe("wiring", () => {
  const rentals = readFileSync(new URL("../src/lib/rentals.functions.ts", import.meta.url), "utf8");
  const incidents = readFileSync(new URL("../src/lib/incidents.functions.ts", import.meta.url), "utf8");
  const helper = readFileSync(new URL("../src/lib/renter-lifecycle-notices.server.ts", import.meta.url), "utf8");
  const automations = readFileSync(new URL("../src/lib/automations.server.ts", import.meta.url), "utf8");

  it("keeps each locked-file hook behind the flag and off the direct transports", () => {
    assert.equal(rentals.match(/RENTER_LIFECYCLE_NOTICES_ENABLED === "true"/g)?.length, 3);
    assert.equal(incidents.match(/RENTER_LIFECYCLE_NOTICES_ENABLED === "true"/g)?.length, 1);
    assert.match(rentals, /event: "rental_started"/);
    assert.equal(rentals.match(/event: "rental_ended"/g)?.length, 2);
    assert.match(incidents, /event: "incident_logged", applicationId, rentalId, fresh: !data.id/);
    assert.match(rentals, /subject: `You're approved — \$\{vehicleLabel\} is yours`/);
    assert.match(rentals, /kind: "rental_activated"/);
    assert.match(rentals, /kind: "rental_started"/);
    assert.doesNotMatch(helper, /sendEmail\(|sendSms\(|TWILIO_|RESEND_/);
    assert.match(automations, /"rental_ended"/);
    assert.match(automations, /"incident_logged"/);
  });
});
