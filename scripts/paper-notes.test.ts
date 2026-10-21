import assert from "node:assert/strict";
import { uploadVerified, type Port, type Operation } from "../src/lib/paper-contract";
import { PAPER_RELEASE } from "../src/lib/paper-release";
import { readFileSync } from "node:fs";
let passed = 0;
async function test(name: string, f: () => unknown) {
  await f();
  passed++;
  console.log("PASS " + name);
}
const actor = { id: "10000000-0000-4000-8000-000000000001", role: "admin" };
const d = {
  applicationId: "20000000-0000-4000-8000-000000000001",
  operationId: "30000000-0000-4000-8000-000000000001",
  fileName: "x.pdf",
  base64: btoa("%PDF-1.7\nsynthetic\n%%EOF"),
  signedOn: null,
  agreementType: "original",
  note: null as string | null,
};
function fixture() {
  let row: Operation | null = null;
  let bytes: Uint8Array | null = null;
  let uploads = 0;
  const port: Port = {
    async operation() {
      return row;
    },
    async read() {
      return bytes;
    },
    async upload(_p, b) {
      bytes = b;
      uploads++;
    },
    async attest(r) {
      row = { ...r, state: "verified", result_document_id: null };
    },
    async register(id) {
      return { status: "registered", operation_id: id, document_id: id };
    },
  };
  return {
    port,
    get row() {
      return row;
    },
    get uploads() {
      return uploads;
    },
  };
}
for (const note of [null, "", "  retain whitespace\n", "résumé — 中文", "x".repeat(1000)])
  await test("exact Notes persistence " + String(note).length, async () => {
    const f = fixture();
    await uploadVerified(actor, { ...d, note }, f.port);
    assert.equal(f.row?.initial_note, note);
  });
await test("oversized Notes rejected before upload", async () => {
  const f = fixture();
  await assert.rejects(() => uploadVerified(actor, { ...d, note: "x".repeat(1001) }, f.port));
  assert.equal(f.uploads, 0);
});
await test("same operation cannot replace Notes", async () => {
  const f = fixture();
  await uploadVerified(actor, { ...d, note: "one" }, f.port);
  await assert.rejects(() => uploadVerified(actor, { ...d, note: "two" }, f.port));
});
await test("Coordinator note creation denied", () =>
  assert.rejects(() =>
    uploadVerified({ ...actor, role: "coordinator" }, { ...d, note: "no" }, fixture().port),
  ));
await test("actor override refused", () =>
  assert.rejects(() => uploadVerified(actor, { ...d, actor_id: "forged" }, fixture().port)));
await test("no separate document/audit mutation in upload handler", () => {
  const s = readFileSync("src/lib/paper-agreements.functions.ts", "utf8");
  assert.ok(!s.includes("logAudit("));
  assert.ok(!/from\("(?:documents|audit_log)"\)[\s\S]{0,40}\.insert/.test(s));
  assert.ok(s.includes('scoped.rpc("register_paper_agreement"'));
});
await test("no Notes fallback from Driver-visible documents column", () => {
  const s = readFileSync("src/lib/paper-agreements.functions.ts", "utf8");
  assert.ok(s.includes("notes: undefined"));
  assert.ok(s.includes("paper_agreement.note_updated"));
});
await test("account changes clear sensitive draft fields", () => {
  const s = readFileSync("src/components/admin/PaperAgreements.tsx", "utf8");
  for (const x of ["setFile(null)", 'setNote("")', "setOperation(null)"]) assert.ok(s.includes(x));
});
await test("all Paper feature activation remains disabled", () =>
  assert.deepEqual(PAPER_RELEASE, { visible: false, registration: false }));
console.log(
  JSON.stringify({
    pass: passed,
    fail: 0,
    scope: "targeted mocked Notes application and source guards",
  }),
);
