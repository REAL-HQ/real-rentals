/**
 * Wizard save reliability (PR 4): retry classification and backoff,
 * autosave/step-change sequencing, upload-save failure surfacing, and the
 * wizard wiring that uses them. Pure logic with fake clocks; no network.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(tmpdir(), "rr-wizard-save-"));
await build({
  entryPoints: ["src/lib/wizard-save.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(out, "save.mjs"),
  alias: { "@": resolve("src") },
  logLevel: "silent",
});
const save = await import(pathToFileURL(join(out, "save.mjs")).href);

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log("PASS", name);
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const noSleep = async () => {};

// ------------------------------------------------------------ classification
{
  const yes = [
    new Error(save.SAVE_BUSY_MESSAGE),
    new Error("could not serialize access due to concurrent update"),
    { code: "40001", message: "x" },
    new TypeError("Failed to fetch"),
    new TypeError("NetworkError when attempting to fetch resource."),
    new TypeError("Load failed"),
    new Error("The Internet connection appears to be offline."),
    { status: 503, message: "Service Unavailable" },
  ];
  const no = [
    new Error("This link is no longer valid. Ask us for a new one and we'll send it over."),
    new Error("That file reference is not one we issued."),
    new Error("Expected string, received number"),
    null,
    undefined,
    new Error("Order 400013 failed"), // digits that merely contain 40001 are not the code
  ];
  for (const e of yes) assert.equal(save.isRetryableSaveError(e), true, String(e?.message ?? e));
  for (const e of no) assert.equal(save.isRetryableSaveError(e), false, String(e?.message ?? e));
  assert.match(save.SAVE_BUSY_MESSAGE, /\b40001\b/);
  ok("40001 / serialization and network failures retry; validation and expired links do not");
}

{
  for (let attempt = 1; attempt <= 8; attempt++) {
    const ceiling = Math.min(6000, 400 * 2 ** (attempt - 1));
    const lo = save.retryDelayMs(attempt, { random: () => 0 });
    const hi = save.retryDelayMs(attempt, { random: () => 1 });
    assert.equal(lo, Math.round(ceiling / 2));
    assert.equal(hi, ceiling);
  }
  const spread = new Set(Array.from({ length: 20 }, (_, i) => save.retryDelayMs(3, { random: () => i / 20 })));
  assert.ok(spread.size > 10, "jitter spreads retries");
  ok("backoff is exponential, capped at 6s, with equal jitter");
}

{
  let calls = 0;
  const delays = [];
  const result = await save.withSaveRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error(save.SAVE_BUSY_MESSAGE);
      return "saved";
    },
    { sleep: async (ms) => void delays.push(ms), random: () => 0.5 },
  );
  assert.equal(result, "saved");
  assert.equal(calls, 3);
  assert.equal(delays.length, 2);
  ok("a 40001 conflict is retried and then succeeds");
}

{
  let calls = 0;
  await assert.rejects(
    save.withSaveRetry(async () => {
      calls++;
      throw new Error("This link is no longer valid.");
    }, { sleep: noSleep }),
    /no longer valid/,
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    save.withSaveRetry(async () => {
      calls++;
      throw new TypeError("Failed to fetch");
    }, { sleep: noSleep }),
    /Failed to fetch/,
  );
  assert.equal(calls, save.DEFAULT_SAVE_ATTEMPTS);
  ok("non-retryable errors fail at once; retryable ones stop after a bounded number of attempts");
}

// ---------------------------------------------------------------- sequencing
/** A fake server: requests apply in the order they ARRIVE, each after its own latency. */
function fakeServer() {
  const row = { current_step: "rental", city: null };
  const arrivals = [];
  return {
    row,
    arrivals,
    write(payload, gate) {
      return async () => {
        arrivals.push(payload.step);
        await gate;
        const { step, ...fields } = payload;
        Object.assign(row, fields, { current_step: step });
        return { ...row };
      };
    },
  };
}

{
  const seq = save.createSaveSequencer();
  const server = fakeServer();
  const slow = deferred();
  const auto = seq.autosave(server.write({ step: "rental", city: "Tampa" }, slow.promise));
  await tick();
  assert.equal(seq.busy, true);
  const step = seq.stepChange(server.write({ step: "driving", city: "Tampa" }, Promise.resolve()));
  await tick();
  // The step change has not been sent while the autosave is still on the wire.
  assert.deepEqual(server.arrivals, ["rental"]);
  slow.resolve();
  await auto;
  await step;
  assert.deepEqual(server.arrivals, ["rental", "driving"]);
  assert.equal(server.row.current_step, "driving");
  ok("a step change waits for an in-flight autosave, so current_step ends on the new step");
}

{
  const seq = save.createSaveSequencer();
  const server = fakeServer();
  const slow = deferred();
  const first = seq.autosave(server.write({ step: "rental", city: "A" }, slow.promise));
  const queued = seq.autosave(server.write({ step: "rental", city: "B" }, Promise.resolve()));
  const step = seq.stepChange(server.write({ step: "driving", city: "B" }, Promise.resolve()));
  const dropped = assert.rejects(queued, (e) => e instanceof save.SaveSuperseded);
  slow.resolve();
  await first;
  await dropped;
  await step;
  assert.deepEqual(server.arrivals, ["rental", "driving"]);
  assert.equal(server.row.current_step, "driving");
  ok("an autosave queued before a step change is dropped and never lands after it");
}

{
  const seq = save.createSaveSequencer();
  let autoCalls = 0;
  const sleeping = deferred();
  const auto = seq.autosave(
    async () => {
      autoCalls++;
      throw new TypeError("Failed to fetch");
    },
    {
      // A long backoff that only a step change can cut short.
      sleep: (ms) => {
        sleeping.resolve(ms);
        return new Promise((r) => setTimeout(r, 60_000).unref?.());
      },
    },
  );
  await sleeping.promise;
  const started = Date.now();
  const step = seq.stepChange(async () => "driving");
  await assert.rejects(auto, /Failed to fetch/);

  assert.equal(await step, "driving");
  assert.equal(autoCalls, 1, "the stale autosave retried after the step change");
  assert.ok(Date.now() - started < 1000, "the step change waited out the autosave's backoff");
  ok("a step change cancels a stale autosave's retries without waiting out its backoff");
}

{
  const seq = save.createSaveSequencer();
  let calls = 0;
  const value = await seq.stepChange(
    async () => {
      calls++;
      if (calls === 1) throw new Error(save.SAVE_BUSY_MESSAGE);
      return "ok";
    },
    { sleep: noSleep },
  );
  assert.equal(value, "ok");
  assert.equal(calls, 2);
  ok("the step change itself retries a 40001 conflict");
}

{
  const seq = save.createSaveSequencer();
  const order = [];
  const a = deferred();
  const p1 = seq.serial(async () => {
    order.push("a:start");
    await a.promise;
    order.push("a:end");
  });
  const p2 = seq.serial(async () => {
    order.push("b:start");
  });
  await tick();
  assert.deepEqual(order, ["a:start"]);
  a.resolve();
  await Promise.all([p1, p2]);
  assert.deepEqual(order, ["a:start", "a:end", "b:start"]);
  ok("upload saves are serialized, so two quick uploads land in order");
}

{
  const seq = save.createSaveSequencer();
  const failed = seq.serial(async () => {
    throw new Error("nope");
  });
  await assert.rejects(failed, /nope/);
  assert.equal(await seq.serial(async () => "next"), "next");
  assert.equal(seq.busy, false);
  ok("one failed write does not jam the queue");
}

// ----------------------------------------------------- upload-save surfacing
{
  let marked = false;
  const errors = [];
  await assert.rejects(
    save.saveThenMark(
      async () => {
        throw new TypeError("Failed to fetch");
      },
      () => {
        marked = true;
      },
      (e) => errors.push(e),
    ),
    (e) => e.message === save.UPLOAD_SAVE_FAILED_MESSAGE,
  );
  assert.equal(marked, false, "marked on file although the save failed");
  assert.equal(errors.length, 1);
  await save.saveThenMark(async () => {}, () => {
    marked = true;
  });
  assert.equal(marked, true);
  assert.match(save.UPLOAD_SAVE_FAILED_MESSAGE, /Retry/);
  ok("an upload is marked on file only after its save succeeds; a failure surfaces a Retry message");
}

{
  let uploads = 0;
  let saves = 0;
  let failNext = true;
  const run = save.createUploadThenSave(async (path) => {
    saves++;
    if (failNext) {
      failNext = false;
      throw new Error(save.UPLOAD_SAVE_FAILED_MESSAGE);
    }
  });
  const file = { name: "licence.jpg" };
  const upload = async () => {
    uploads++;
    return { path: `app/licence-${uploads}.jpg` };
  };
  await assert.rejects(run(file, upload), (e) => e.message === save.UPLOAD_SAVE_FAILED_MESSAGE);
  const path = await run(file, upload); // the uploader's Retry passes the same File
  assert.equal(path, "app/licence-1.jpg");
  assert.equal(uploads, 1, "Retry uploaded the photo again");
  assert.equal(saves, 2);
  await run(file, upload);
  assert.equal(uploads, 2, "a later fresh pick of the same File uploads again once saved");
  ok("Retry after a failed save re-sends the save only, without a second upload");
}

// ------------------------------------------------------------- wiring checks
{
  const wiz = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
  const capture = readFileSync("src/components/site/DocumentCapture.tsx", "utf8");
  const fns = readFileSync("src/lib/applications.functions.ts", "utf8");

  assert.doesNotMatch(wiz, /quiet: true/, "quiet upload saves are gone");
  assert.match(wiz, /saveThenMark\(\s*\(\) => saveUploadRow\(\{ \[column\]: path \}\),\s*\(\) => update\(presence, Boolean\(path\)\)/);
  assert.match(wiz, /<UploadSaveAlert busy=\{tripSaveBusy\} onRetry=/);
  assert.match(capture, /createUploadThenSave<File>/);
  assert.match(capture, /<FileUploader/);
  assert.match(capture, /uploadApplicantFile\(\{ token, kind, file \}\)/);

  assert.match(wiz, /addEventListener\("pagehide", flush\)/);
  assert.match(wiz, /document\.visibilityState === "hidden"/);
  assert.match(wiz, /keepalive: true/);
  assert.match(wiz, /seq\.stepChange\(/);
  assert.match(wiz, /seq\.autosave\(write\)/);
  assert.match(wiz, /Couldn't Save/);
  assert.match(wiz, /Saving…/);
  assert.doesNotMatch(wiz.slice(wiz.indexOf("function SavedIndicator"), wiz.indexOf("function NavRow")), /uppercase/);

  assert.match(fns, /error\.code === SAVE_BUSY_CODE \? SAVE_BUSY_MESSAGE : error\.message/);
  ok("wizard wiring: flush on hide, keepalive, sequenced writes, visible status, no swallowed upload saves");
}

{
  const apply = readFileSync("src/routes/apply.tsx", "utf8");
  assert.match(apply, /label="Mobile Phone"[^\n]*type="tel"[^\n]*inputMode="tel"[^\n]*autoComplete="tel"/);
  assert.match(apply, /label="Email"[^\n]*type="email"[^\n]*inputMode="email"[^\n]*autoComplete="email"/);
  assert.match(apply, /label="Full Name"[^\n]*autoComplete="name"/);
  // Validation is unchanged: still the same JS checks, and no <form> whose
  // native type validation could block Continue.
  assert.match(apply, /if \(!z\.string\(\)\.email\(\)\.safeParse\(form\.email\)\.success\) e\.email = "Invalid email";/);
  assert.match(apply, /if \(!\/\^\\d\{7,\}\$\/\.test\(form\.phone\.replace\(\/\\D\/g, ""\)\)\) e\.phone = "Invalid phone";/);
  assert.doesNotMatch(apply.slice(apply.indexOf("const contact = ("), apply.indexOf("function In(")), /<form\b/);
  const wiz = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
  for (const token of ["street-address", "address-level2", "address-level1", "postal-code"]) {
    assert.ok(wiz.includes(`autoComplete="${token}"`), token);
  }
  ok("mobile inputs: tel/email keyboards and autocomplete tokens, validation unchanged");
}


// ------------------------------------------- PR 1 lock is terminal (stacked)
{
  const editStatus = readFileSync("src/lib/application-edit-status.ts", "utf8");
  const LOCKED = editStatus.match(/APPLICATION_LOCKED_MESSAGE =\s*"([^"]+)"/)[1];
  const locked = new Error(LOCKED);
  assert.equal(save.isApplicationLockedError(locked), true);
  assert.equal(save.isRetryableSaveError(locked), false, "a locked refusal must never be retried");
  assert.equal(save.isApplicationLockedError(new Error(save.SAVE_BUSY_MESSAGE)), false);
  assert.equal(save.isApplicationLockedError(new TypeError("Failed to fetch")), false);

  let calls = 0;
  await assert.rejects(
    save.withSaveRetry(async () => {
      calls++;
      throw locked;
    }, { sleep: noSleep }),
    (e) => e === locked,
  );
  assert.equal(calls, 1);

  const seq = save.createSaveSequencer();
  calls = 0;
  await assert.rejects(seq.autosave(async () => { calls++; throw locked; }, { sleep: noSleep }), (e) => e === locked);
  await assert.rejects(seq.stepChange(async () => { calls++; throw locked; }, { sleep: noSleep }), (e) => e === locked);
  await assert.rejects(seq.serial(async () => { calls++; throw locked; }, { sleep: noSleep }), (e) => e === locked);
  assert.equal(calls, 3, "each locked write was sent exactly once");

  // 40001 and network errors still retry next to it.
  calls = 0;
  await save.withSaveRetry(async () => {
    calls++;
    if (calls === 1) throw new Error(save.SAVE_BUSY_MESSAGE);
    if (calls === 2) throw new TypeError("Failed to fetch");
  }, { sleep: noSleep });
  assert.equal(calls, 3);
  ok("a locked (decided) refusal is terminal: sent once, never retried; 40001 and network errors still retry");
}

{
  const wiz = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
  const fns = readFileSync("src/lib/applications.functions.ts", "utf8");
  // Autosave: the lock check comes before any retry is scheduled.
  const auto = wiz.slice(wiz.indexOf("const autosaveNow ="), wiz.indexOf("const autosaveRef ="));
  assert.ok(auto.indexOf("isApplicationLockedError(err)") > 0);
  assert.ok(auto.indexOf("isApplicationLockedError(err)") < auto.indexOf("retryTimer.current = setTimeout"));
  assert.match(auto, /lockedRef\.current\) return;/, "nothing is sent once locked");
  const lockNow = wiz.slice(wiz.indexOf("const lockNow ="), wiz.indexOf("const lockNow =") + 300);
  assert.match(lockNow, /lockedRef\.current = true;[\s\S]*dirty\.current = false;[\s\S]*clearRetry\(\);[\s\S]*setLocked\(true\)/);
  // Next/Submit and Part 2 saves hand a lock to the read-only screen.
  const go = wiz.slice(wiz.indexOf("const go = async"), wiz.indexOf("const inPart1 ="));
  assert.ok(go.indexOf("isApplicationLockedError(e)") < go.indexOf("toast.error"));
  assert.match(wiz, /if \(isApplicationLockedError\(e\)\) \{\s*onLocked\(\);/);
  assert.match(wiz, /if \(locked\) return <ApplicationLocked \/>;/);
  assert.match(wiz, /if \(row\.editable === false\) setLocked\(true\);/);
  // Server: PR 1's guard and PR 4's 40001 mapping both present.
  const step = fns.slice(fns.indexOf("export const updateApplicationStep"), fns.indexOf("export const updateApplicationStep") + 12000);
  assert.match(step, /if \(!isApplicantEditableStatus\(before\?\.status\)\) \{\s*throw new Error\(APPLICATION_LOCKED_MESSAGE\);/);
  assert.match(step, /\.in\("status", \[\.\.\.APPLICANT_EDITABLE_STATUSES\]\)\s*\.select\("\*"\)\s*\.maybeSingle\(\);/);
  assert.match(step, /error\.code === SAVE_BUSY_CODE \? SAVE_BUSY_MESSAGE : error\.message/);
  assert.match(step, /if \(!row\) throw new Error\(APPLICATION_LOCKED_MESSAGE\);/);
  ok("stacked on PR 1: edit lock and 40001 mapping coexist; the wizard locks instead of retrying");
}

rmSync(out, { recursive: true, force: true });
console.log(`${passed} wizard save checks passed`);
