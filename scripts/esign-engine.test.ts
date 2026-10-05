/**
 * Live eSign engine checks against the real database (service role).
 * Creates throwaway standalone documents and deletes them afterwards.
 * Run: bun scripts/esign-engine.test.ts
 */
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";
import { completeSigning, voidDocument, hashToken, randomToken, retryArchive } from "../src/lib/esign.server";

let fail = 0;
const ok = (c: boolean, l: string) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}`); };
const created: string[] = [];

async function mk(opts: { expired?: boolean; appId?: string | null } = {}) {
  const token = randomToken();
  const hash = await hashToken(token);
  const { data, error } = await admin.from("agreements").insert({
    source: opts.appId ? "rental" : "standalone",
    application_id: opts.appId ?? null,
    title: "ESIGN ENGINE TEST",
    body: "Test agreement body.\nLine two with enough text to wrap a little across the page width for the PDF renderer.",
    status: "sent",
    sent_at: new Date().toISOString(),
    token_hash: hash,
    token_expires_at: new Date(Date.now() + (opts.expired ? -60_000 : 3600_000)).toISOString(),
    signer_email: "esign-test@drivereal.com",
  }).select("id").single();
  if (error) throw error;
  created.push(data.id);
  return { id: data.id as string, hash };
}
const sign = (id: string, hash: string | null, name = "Test Signer") =>
  completeSigning(admin, { id, tokenHash: hash, signerName: name, ip: "203.0.113.9", userAgent: "test", authMethod: hash ? "email_link" : "portal" })
    .then((r) => r.result).catch((e) => `error:${e.message}`);

try {
  const { data: app } = await admin.from("applications").select("id").limit(1).single();

  console.log("A/N. SIMULTANEOUS SIGNING");
  const a = await mk({ appId: app!.id });
  const results = await Promise.all(Array.from({ length: 5 }, () => sign(a.id, a.hash)));
  ok(results.filter((r) => r === "won").length === 1, `exactly one winner (${results.join(",")})`);
  const { data: aRow } = await admin.from("agreements").select("status,archive_status,document_id,sha256").eq("id", a.id).single();
  ok(aRow!.status === "signed", "status signed");
  ok(aRow!.archive_status === "archived" && !!aRow!.document_id, `archived with document (${aRow!.archive_status})`);
  ok(/^[0-9a-f]{64}$/.test(aRow!.sha256 ?? ""), "pdf sha256 stored");
  const { count } = await admin.from("documents").select("id", { count: "exact", head: true }).eq("storage_path", `${app!.id}/agreement-${a.id}.pdf`);
  ok(count === 1, `one documents row (${count})`);

  console.log("E. ALREADY SIGNED");
  ok((await sign(a.id, a.hash)) !== "won", "re-sign with old token does not win");
  ok((await sign(a.id, null)) === "already_signed", "portal re-sign -> already_signed");

  console.log("B. SIGN VS VOID");
  ok((await voidDocument(admin, a.id, null)) === "signed", "signed cannot be voided");
  const b = await mk({ appId: app!.id });
  const [v, s] = await Promise.all([voidDocument(admin, b.id, null), sign(b.id, b.hash)]);
  const { data: bRow } = await admin.from("agreements").select("status").eq("id", b.id).single();
  ok((v === "voided") !== (s === "won"), `exactly one of void/sign won (void=${v}, sign=${s})`);
  ok(bRow!.status === (v === "voided" ? "voided" : "signed"), `final state consistent (${bRow!.status})`);
  const c = await mk();
  await voidDocument(admin, c.id, null);
  ok((await sign(c.id, null)) === "voided", "voided cannot become signed (portal path)");

  console.log("C/F. TOKENS");
  const d = await mk();
  const newHash = await hashToken(randomToken());
  await admin.from("agreements").update({ token_hash: newHash }).eq("id", d.id);
  ok((await sign(d.id, d.hash)) === "invalid", "old token after resend rejected");
  ok((await sign(d.id, await hashToken("guess"))) === "invalid", "guessed token rejected");

  console.log("D. EXPIRED");
  const e = await mk({ expired: true });
  ok((await sign(e.id, e.hash)) === "expired", "expired token rejected");

  console.log("I/J. ARCHIVE FAILURE IS VISIBLE + RECOVERABLE");
  const f = await mk({ appId: app!.id });
  const realFrom = admin.storage.from.bind(admin.storage);
  (admin.storage as any).from = () => ({ upload: async () => ({ error: { message: "simulated outage" } }) });
  const fr = await sign(f.id, f.hash);
  (admin.storage as any).from = realFrom;
  const { data: fRow } = await admin.from("agreements").select("status,archive_status,archive_error,document_id").eq("id", f.id).single();
  ok(fr === "won" && fRow!.status === "signed", "signature still committed");
  ok(fRow!.archive_status === "failed" && !!fRow!.archive_error && !fRow!.document_id, `failure recorded (${fRow!.archive_status})`);
  ok(await retryArchive(admin, f.id, null), "retry succeeds");
  const { data: fRow2 } = await admin.from("agreements").select("archive_status,document_id").eq("id", f.id).single();
  ok(fRow2!.archive_status === "archived" && !!fRow2!.document_id, "recovered to archived");
} finally {
  for (const id of created) {
    const { data: r } = await admin.from("agreements").select("document_id,application_id").eq("id", id).single();
    if (r?.document_id) await admin.from("documents").delete().eq("id", r.document_id);
    await admin.storage.from("rental-agreements").remove([`${r?.application_id ?? "standalone"}/agreement-${id}.pdf`]);
    await admin.from("audit_log").delete().eq("entity_id", id);
    await admin.from("agreements").delete().eq("id", id);
  }
}
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
