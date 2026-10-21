import assert from "node:assert/strict";
import {
  uploadVerified,
  recoverBound,
  boundResult,
  type Port,
  type Operation,
  type Attestation,
} from "../src/lib/paper-contract";
import {
  retentionOutcome,
  reconcileCleanupJob,
  staffDeletionMessage,
} from "../src/lib/paper-retention";
import { checkPaperPdf, validSignedOn } from "../src/lib/paper-agreements";
import { PAPER_RELEASE } from "../src/lib/paper-release";
const checks: string[] = [];
async function test(name: string, fn: () => unknown) {
  await fn();
  checks.push(name);
}
const actor = { id: "10000000-0000-4000-8000-000000000001", role: "admin" };
const input = {
  applicationId: "20000000-0000-4000-8000-000000000001",
  operationId: "30000000-0000-4000-8000-000000000001",
  fileName: "signed.pdf",
  base64: btoa("%PDF-1.7\nsynthetic\n%%EOF"),
  signedOn: "2026-10-15",
  agreementType: "original",
  note: null,
};
function fixture() {
  let op: Operation | null = null;
  let bytes: Uint8Array | null = null;
  let uploads = 0;
  let registrations = 0;
  let failAudit = false;
  let lost = false;
  const port: Port = {
    async operation() {
      return op;
    },
    async read() {
      return bytes;
    },
    async upload(_p, b) {
      uploads++;
      bytes = b;
    },
    async attest(a: Attestation) {
      op = { ...a, state: "verified", result_document_id: null };
    },
    async register(id) {
      registrations++;
      if (failAudit) throw Error("audit rollback (mock)");
      op!.state = "registered";
      op!.result_document_id = id;
      if (lost) {
        lost = false;
        throw Error("lost response");
      }
      return {
        status: "registered",
        operation_id: id,
        document_id: id,
        recovered: registrations > 1,
      };
    },
  };
  return {
    port,
    get op() {
      return op;
    },
    get uploads() {
      return uploads;
    },
    set failAudit(v: boolean) {
      failAudit = v;
    },
    set lost(v: boolean) {
      lost = v;
    },
  };
}
await test("Owner exact-byte registration", async () =>
  assert.equal((await uploadVerified(actor, input, fixture().port)).status, "registered"));
await test("Manager allowed", async () =>
  assert.equal(
    (await uploadVerified({ ...actor, role: "team" }, input, fixture().port)).status,
    "registered",
  ));
for (const role of ["coordinator", "driver", "anon", "service_role"])
  await test(`${role} denied before upload`, async () => {
    const f = fixture();
    await assert.rejects(() => uploadVerified({ ...actor, role }, input, f.port));
    assert.equal(f.uploads, 0);
  });
await test("actor override rejected", () =>
  assert.rejects(() => uploadVerified(actor, { ...input, actorId: actor.id }, fixture().port)));
await test("Notes preserved in attestation without normalization", async () => {
  const f = fixture();
  await uploadVerified(actor, { ...input, note: "  exact\ntext  " }, f.port);
  assert.equal(f.op?.initial_note, "  exact\ntext  ");
});
await test("invalid PDF refused", () =>
  assert.rejects(() =>
    uploadVerified(actor, { ...input, base64: btoa("not a PDF") }, fixture().port),
  ));
await test("date overflow rejected", () =>
  assert.equal(validSignedOn("2026-02-31", "2026-10-17"), false));
await test("stored hash mismatch preserves candidate", async () => {
  const f = fixture();
  f.port.read = async () => new TextEncoder().encode("wrong");
  await assert.rejects(() => uploadVerified(actor, input, f.port));
  assert.equal(f.op, null);
});
await test("missing RPC fails closed with attestation preserved", async () => {
  const f = fixture();
  f.port.register = async () => {
    throw Error("missing RPC");
  };
  await assert.rejects(() => uploadVerified(actor, input, f.port));
  assert.equal(f.op?.state, "verified");
});
await test("attestation persistence failure preserves object", async () => {
  const f = fixture();
  f.port.attest = async () => {
    throw Error("DB unavailable");
  };
  await assert.rejects(() => uploadVerified(actor, input, f.port));
  assert.equal(f.uploads, 1);
});
await test("lost response recovered without upload replay", async () => {
  const f = fixture();
  f.lost = true;
  await assert.rejects(() => uploadVerified(actor, input, f.port));
  assert.equal(
    (await recoverBound(actor.id, input.applicationId, input.operationId, f.port)).status,
    "registered",
  );
  assert.equal(f.uploads, 1);
});
await test("different actor cannot recover", async () => {
  const f = fixture();
  await uploadVerified(actor, input, f.port);
  await assert.rejects(() => recoverBound("other", input.applicationId, input.operationId, f.port));
});
await test("different Driver cannot recover", async () => {
  const f = fixture();
  await uploadVerified(actor, input, f.port);
  await assert.rejects(() => recoverBound(actor.id, "other", input.operationId, f.port));
});
await test("operation payload rebinding rejected", async () => {
  const f = fixture();
  await uploadVerified(actor, input, f.port);
  await assert.rejects(() =>
    uploadVerified(actor, { ...input, agreementType: "addendum" }, f.port),
  );
});
await test("audit failure never returns saved (mock)", async () => {
  const f = fixture();
  f.failAudit = true;
  await assert.rejects(() => uploadVerified(actor, input, f.port));
  assert.equal(f.op?.state, "verified");
});
await test("invalid RPC response rejected", () =>
  assert.throws(() =>
    boundResult({ status: "registered", operation_id: input.operationId }, input.operationId),
  ));
await test("other operation response rejected", () =>
  assert.throws(() =>
    boundResult({ status: "cancelled", operation_id: actor.id }, input.operationId),
  ));
await test("duplicate result preserved", () =>
  assert.equal(
    boundResult(
      { status: "duplicate", operation_id: input.operationId, document_id: input.operationId },
      input.operationId,
    ).status,
    "duplicate",
  ));
for (const type of ["original", "addendum", "extension"])
  await test(`${type} passed to immutable attestation`, async () => {
    const f = fixture();
    await uploadVerified(actor, { ...input, agreementType: type }, f.port);
    assert.equal(f.op?.agreement_type, type);
  });
const clean = {
  complete: true,
  failedJobs: 0,
  pendingJobs: 0,
  retained: 0,
  legalHold: false,
  operationalHold: false,
  storageVerifiedAbsent: true,
  databaseErasureVerified: true,
};
for (const [key, value, outcome] of [
  ["retained", 1, "Retained"],
  ["legalHold", true, "Retained"],
  ["operationalHold", true, "Retained"],
  ["pendingJobs", 1, "Pending"],
  ["failedJobs", 1, "Failed"],
  ["complete", false, "Failed"],
  ["storageVerifiedAbsent", false, "Pending"],
  ["databaseErasureVerified", false, "Pending"],
] as const)
  await test(`retention ${key}`, () =>
    assert.equal(retentionOutcome({ ...clean, [key]: value }).outcome, outcome));
await test("completed requires all evidence", () =>
  assert.equal(retentionOutcome(clean).outcome, "Completed"));
await test("failed job persistence fails closed", async () =>
  assert.equal(
    (
      await reconcileCleanupJob(
        { id: "job", attempts: 0 },
        { absenceVerified: true },
        async () => ({ error: "db", updatedIds: [] }),
      )
    ).outcome,
    "Failed",
  ));
await test("Storage failure never completed", async () =>
  assert.equal(
    (
      await reconcileCleanupJob(
        { id: "job", attempts: 0 },
        { error: "Storage", absenceVerified: false },
        async () => ({ error: null, updatedIds: ["job"] }),
      )
    ).outcome,
    "Failed",
  ));
await test("staff retention hold explicit", () =>
  assert.match(staffDeletionMessage("PAPER_AUDIT_ACTOR_RETENTION_HOLD"), /Retained/));
await test("unrelated error unchanged", () =>
  assert.equal(staffDeletionMessage("unrelated"), "unrelated"));
await test("registration and feature remain disabled", () =>
  assert.deepEqual(PAPER_RELEASE, { visible: false, registration: false }));
console.log(
  JSON.stringify(
    {
      pass: checks.length,
      fail: 0,
      scope:
        "Mocked application and pure rules; PostgreSQL concurrency/audit evidence is separately preserved",
      checks,
    },
    null,
    2,
  ),
);
