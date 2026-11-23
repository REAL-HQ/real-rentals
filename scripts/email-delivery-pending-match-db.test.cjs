// Local Postgres proof for supabase/migrations/20261122200000_email_delivery_pending_match.sql.
// email_deliveries and its three functions are copied verbatim from
// production (read-only, Nov 22 2026). Applies the migration twice, then
// checks: attach never moves a row backwards; an unmatched webhook folds into
// exactly one pending row (recipient + subject + time); ambiguous, mismatched
// or old rows are left alone. Skips (exit 0) without postgres binaries.
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const assert = require("assert/strict");
const { execFileSync, spawn, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const MIGRATION = path.join(root, "supabase/migrations/20261122200000_email_delivery_pending_match.sql");
function findBin() {
  const cands = [process.env.PG_BIN, "/workspace/pg17/node_modules/@embedded-postgres/linux-x64/native/bin"];
  try { cands.push(execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim()); } catch {}
  for (const c of cands) if (c && fs.existsSync(path.join(c, "postgres")) && fs.existsSync(path.join(c, "initdb"))) return c;
  return null;
}
const bin = findBin();
const psqlBin = bin && [path.join(bin, "psql"), "/usr/bin/psql"].find((p) => fs.existsSync(p));
if (!bin || !psqlBin) { console.log("SKIP email-delivery-pending-match-db: no local postgres (set PG_BIN)"); process.exit(0); }
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

const STUB = String.raw`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.email_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resend_message_id text UNIQUE, workflow text NOT NULL,
  recipient text NOT NULL, state text NOT NULL DEFAULT 'accepted' CHECK (state = ANY (ARRAY['sending','accepted','delivered','bounced','complained','failed'])),
  accepted_at timestamptz, delivered_at timestamptz, bounced_at timestamptz, complained_at timestamptz, failed_at timestamptz,
  provider_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- Verbatim from production (read-only, Nov 22 2026)
CREATE OR REPLACE FUNCTION public.email_state_rank(_s text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  select case _s when 'sending' then 0 when 'accepted' then 1 when 'delivered' then 2
    when 'failed' then 3 when 'bounced' then 3 when 'complained' then 4 else 0 end
$function$;
CREATE OR REPLACE FUNCTION public.email_delivery_event(_resend_id text, _state text, _reason text, _recipient text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare r public.email_deliveries;
begin
  if _state not in ('accepted','delivered','bounced','complained','failed') then
    raise exception 'invalid state';
  end if;
  perform pg_advisory_xact_lock(hashtext('email_delivery:' || _resend_id));
  select * into r from public.email_deliveries where resend_message_id = _resend_id for update;
  if not found then
    insert into public.email_deliveries(resend_message_id, workflow, recipient, state,
      accepted_at, delivered_at, bounced_at, complained_at, failed_at, provider_reason)
    values (_resend_id, 'unmatched', coalesce(nullif(_recipient,''), 'unknown'), _state,
      case when _state='accepted' then now() end,
      case when _state='delivered' then now() end,
      case when _state='bounced' then now() end,
      case when _state='complained' then now() end,
      case when _state='failed' then now() end,
      left(_reason, 500));
    return 'unmatched';
  end if;
  update public.email_deliveries set
    state = case when public.email_state_rank(_state) > public.email_state_rank(state) then _state else state end,
    accepted_at   = case when _state='accepted'   then coalesce(accepted_at, now())   else accepted_at end,
    delivered_at  = case when _state='delivered'  then coalesce(delivered_at, now())  else delivered_at end,
    bounced_at    = case when _state='bounced'    then coalesce(bounced_at, now())    else bounced_at end,
    complained_at = case when _state='complained' then coalesce(complained_at, now()) else complained_at end,
    failed_at     = case when _state='failed'     then coalesce(failed_at, now())     else failed_at end,
    provider_reason = coalesce(left(_reason, 500), provider_reason),
    updated_at = now()
  where id = r.id;
  return case when r.workflow = 'unmatched' then 'unmatched' else 'matched' end;
end $function$;
CREATE OR REPLACE FUNCTION public.email_delivery_attach(_id uuid, _resend_id text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare p public.email_deliveries; found_p boolean;
begin
  perform pg_advisory_xact_lock(hashtext('email_delivery:' || _resend_id));
  select * into p from public.email_deliveries where resend_message_id = _resend_id and id <> _id for update;
  found_p := found;
  if found_p then delete from public.email_deliveries where id = p.id; end if;
  update public.email_deliveries d set
    resend_message_id = _resend_id,
    state = case when found_p and public.email_state_rank(p.state) > 1 then p.state else 'accepted' end,
    accepted_at = coalesce(d.accepted_at, p.accepted_at, now()),
    delivered_at = coalesce(d.delivered_at, p.delivered_at),
    bounced_at = coalesce(d.bounced_at, p.bounced_at),
    complained_at = coalesce(d.complained_at, p.complained_at),
    failed_at = coalesce(d.failed_at, p.failed_at),
    provider_reason = coalesce(p.provider_reason, d.provider_reason),
    updated_at = now()
  where d.id = _id;
end $function$;
`;

let dir, port, proc;
function psql(sql) {
  const r = spawnSync(psqlBin, ["-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAtX", "-c", sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}\n${sql}`);
  return r.stdout.trim();
}
function psqlFile(file) {
  const r = spawnSync(psqlBin, ["-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAtX", "-f", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql -f failed: ${r.stderr}`);
}
let passed = 0;
function test(name, fn) { psql("TRUNCATE public.email_deliveries"); fn(); passed++; console.log("PASS", name); }
const pending = (id, recipient, subject, secsAgo = 2, workflow = "lead_alert") =>
  psql(`INSERT INTO public.email_deliveries(id, workflow, recipient, state, subject, created_at) VALUES ('${id}','${workflow}','${recipient}','sending',${subject === null ? "NULL" : `'${subject}'`}, now() - interval '${secsAgo} seconds')`);
const event = (rid, state, to) => psql(`SELECT public.email_delivery_event('${rid}','${state}',NULL,'${to}')`);
const claim = (rid, to, subject) => psql(`SELECT public.email_delivery_claim_pending('${rid}','${to}',${subject === null ? "NULL" : `'${subject}'`}, now())`);
const row = (id) => psql(`SELECT coalesce(resend_message_id,'-')||'|'||state FROM public.email_deliveries WHERE id='${id}'`);
const count = (w = "true") => psql(`SELECT count(*) FROM public.email_deliveries WHERE ${w}`);
const A = "a0000000-0000-4000-8000-000000000001", B = "a0000000-0000-4000-8000-000000000002";

(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "emaildeliv-pg-"));
  port = await freePort();
  execFileSync(path.join(bin, "initdb"), ["-D", path.join(dir, "data"), "-U", "postgres", "--auth=trust", "-E", "UTF8"], { stdio: "ignore" });
  proc = spawn(path.join(bin, "postgres"), ["-D", path.join(dir, "data"), "-p", String(port), "-k", dir, "-c", "listen_addresses="], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    if (spawnSync(psqlBin, ["-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "select 1"]).status === 0) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  try {
    psql(STUB);
    psqlFile(MIGRATION);
    psqlFile(MIGRATION);
    console.log("PASS migration applies twice");

    test("normal send: placeholder from an early webhook still folds in, delivered kept", () => {
      pending(A, "o@x.com", "New Applicant: Pat");
      event("re_1", "delivered", "o@x.com");
      psql(`SELECT public.email_delivery_attach('${A}','re_1')`);
      assert.equal(row(A), "re_1|delivered");
      assert.equal(count(), "1");
    });
    test("cut-off send: the unmatched webhook claims the one pending row", () => {
      pending(A, "O@x.com", "New Applicant: Pat");
      event("re_2", "accepted", "o@x.com");
      assert.equal(claim("re_2", "o@x.com", "New Applicant: Pat"), "attached");
      assert.equal(row(A), "re_2|accepted");
      assert.equal(count("workflow='unmatched'"), "0");
      event("re_2", "delivered", "o@x.com");
      assert.equal(row(A), "re_2|delivered");
    });
    test("attach after a webhook claim never moves the row backwards", () => {
      pending(A, "o@x.com", "S");
      event("re_3", "delivered", "o@x.com");
      assert.equal(claim("re_3", "o@x.com", "S"), "attached");
      psql(`SELECT public.email_delivery_attach('${A}','re_3')`); // the sender finishes late
      assert.equal(row(A), "re_3|delivered");
      assert.equal(count(), "1");
    });
    test("two pending rows for the same recipient: subject decides", () => {
      pending(A, "o@x.com", "New Applicant: Pat");
      pending(B, "o@x.com", "New Applicant: Sam");
      event("re_4", "delivered", "o@x.com");
      assert.equal(claim("re_4", "o@x.com", "New Applicant: Sam"), "attached");
      assert.equal(row(B), "re_4|delivered");
      assert.equal(row(A), "-|sending");
    });
    test("ambiguous (no subjects) is left unmatched", () => {
      pending(A, "o@x.com", null);
      pending(B, "o@x.com", null);
      event("re_5", "delivered", "o@x.com");
      assert.equal(claim("re_5", "o@x.com", null), "ambiguous");
      assert.equal(count("workflow='unmatched'"), "1");
    });
    test("different subject, other recipient, or too old: no candidate", () => {
      pending(A, "o@x.com", "Other");
      pending(B, "o@x.com", "S", 600);
      event("re_6", "delivered", "o@x.com");
      assert.equal(claim("re_6", "o@x.com", "S"), "no_candidate");
      assert.equal(claim("re_6", "z@x.com", "Other"), "no_candidate");
      assert.equal(row(A), "-|sending");
    });
    test("an id that already matched a row is never re-claimed", () => {
      pending(A, "o@x.com", "S");
      psql(`SELECT public.email_delivery_attach('${A}','re_7')`);
      pending(B, "o@x.com", "S");
      assert.equal(claim("re_7", "o@x.com", "S"), "not_unmatched");
      assert.equal(row(B), "-|sending");
    });
    test("bounce on a placeholder still wins over accepted", () => {
      pending(A, "o@x.com", "S");
      event("re_8", "bounced", "o@x.com");
      psql(`SELECT public.email_delivery_attach('${A}','re_8')`);
      assert.equal(row(A), "re_8|bounced");
    });
    test("only service_role can call the claim", () => {
      assert.equal(psql(`SELECT has_function_privilege('anon','public.email_delivery_claim_pending(text,text,text,timestamptz)','execute')::text`), "false");
      assert.equal(psql(`SELECT has_function_privilege('service_role','public.email_delivery_claim_pending(text,text,text,timestamptz)','execute')::text`), "true");
    });
    console.log(`email-delivery-pending-match-db: ${passed} passed`);
  } finally {
    proc.kill("SIGINT");
    await new Promise((res) => setTimeout(res, 500));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); try { proc && proc.kill("SIGKILL"); } catch {} process.exit(1); });
