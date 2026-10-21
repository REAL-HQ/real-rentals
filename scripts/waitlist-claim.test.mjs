/**
 * Dark waitlist claim link. The sender is a mock. No mail provider, no SQL.
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const out = mkdtempSync(join(tmpdir(), "rr-waitlist-claim-"));
const alias = { "@": resolve("src") };

let passed = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  passed += 1;
  console.log("PASS", label);
}

const golden = `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
          <p style="font-size:15px;line-height:1.6">Hi Sam,</p>
          <p style="font-size:15px;line-height:1.6">Good news — a car just became available in Austin. You were at the top of the waitlist, so it's yours to claim before we offer it to anyone else.</p>
          <p style="margin:28px 0">
            <a href="https://drivereal.com/apply" style="background:#D03020;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">Claim it — finish your application</a>
          </p>
          <p style="font-size:13px;line-height:1.6;color:#666">This link takes you straight into the application you started. If the car has already been claimed, you stay at the top of the list for the next one.</p>
          <p style="color:#888;font-size:12px;margin-top:24px">REAL RENTALS · team@drivereal.com · (555) 010-1000</p>
        </div>`;

try {
  await build({
    entryPoints: ["src/lib/waitlist-claim.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "claim.mjs"),
    alias,
  });
  await build({
    entryPoints: ["src/lib/waitlist-claim.server.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "claim-server.mjs"),
    alias,
  });
  const claim = await import(pathToFileURL(join(out, "claim.mjs")).href);
  const server = await import(pathToFileURL(join(out, "claim-server.mjs")).href);

  check(claim.WAITLIST_CLAIM_ENABLED === false, "the claim flag is a hard false");
  check(
    JSON.stringify(claim.applySearchKeys(false)) === JSON.stringify(["t", "city", "pickup", "vehicle", "vehicle_type"]),
    "claim is not a recognized /apply search key while the flag is off",
  );
  check(
    claim.applySearchKeys(true).includes("claim") && claim.applySearchKeys(true).includes("t"),
    "a claim link is its own search key and does not reuse the resume token",
  );

  const off = claim.openingEmail({
    enabled: false,
    fullName: "Sam Rivera",
    city: "Austin",
    href: "https://drivereal.com/apply",
    companyPhone: "(555) 010-1000",
  });
  check(off.subject === "A car just opened up — you're next", "the opening subject is unchanged");
  check(off.html === golden, "the disabled opening email matches the current template");
  check(!off.html.includes("claim="), "the disabled link is bare /apply");

  const escaped = claim.openingEmail({
    enabled: false,
    fullName: "Ann <script> More",
    city: "A & B",
    href: "https://drivereal.com/apply",
    companyPhone: `1 "x"`,
  });
  check(escaped.html.includes("Hi Ann,") && escaped.html.includes("in A &amp; B") && escaped.html.includes("1 &quot;x&quot;"), "names and the phone are escaped");
  check(!escaped.html.includes("<script>"), "a name cannot inject markup");

  const plain = {
    market_id: "m1",
    full_name: "Sam Rivera",
    email: "sam@example.com",
    phone: "",
    driver_status: "",
    city: "Austin",
    utm_source: "ad",
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    gclid: null,
  };
  const inserted = claim.comingSoonSignup(false, plain);
  check(inserted.mode === "insert", "Coming Soon stays an insert while the flag is off");
  check(
    JSON.stringify(inserted.row) === JSON.stringify({
      market_id: "m1",
      full_name: "Sam Rivera",
      email: "sam@example.com",
      phone: null,
      driver_status: "",
      source: "homepage_waitlist",
      utm_source: "ad",
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
      gclid: null,
    }),
    "the disabled Coming Soon row matches today's insert",
  );
  const joined = claim.comingSoonSignup(true, { ...plain, phone: "5550100", driver_status: "active" });
  check(joined.mode === "join" && joined.input.source === "homepage_waitlist" && joined.input.city === "Austin" && joined.input.phone === "5550100" && !("driver_status" in joined.input), "Coming Soon through joinWaitlist drops driver status");

  const row = { id: "11111111-1111-4111-8111-111111111111", full_name: "Sam Rivera", email: "sam@example.com", city: "Austin" };
  const secret = "test-secret-not-a-mailbox";
  async function deliver(enabled, sendOk, claimHref, tokenHash = "abc") {
    const sentTo = [];
    const marked = [];
    let claimCalls = 0;
    const result = await claim.deliverOpeningEmails({
      enabled,
      rows: [row],
      origin: "https://drivereal.com",
      companyPhone: "(555) 010-1000",
      claimUrl: async () => {
        claimCalls += 1;
        if (!claimHref) return null;
        return { href: claimHref, tokenHash };
      },
      send: async (message) => {
        sentTo.push(message);
        return { ok: sendOk };
      },
      markNotified: async (id, hash) => {
        marked.push({ id, hash });
        return true;
      },
    });
    return { result, sentTo, marked, claimCalls };
  }

  const failedOff = await deliver(false, false, "https://drivereal.com/apply?claim=nope");
  check(failedOff.claimCalls === 0, "the disabled send does not build a claim link");
  check(failedOff.sentTo.length === 1 && failedOff.sentTo[0].html === golden, "a mocked failed send still uses the current email");
  check(failedOff.marked.length === 1 && failedOff.marked[0].hash === null && failedOff.result.sent === 0, "a failed send still marks Notified while the flag is off");

  const nonce = "ab".repeat(32);
  const now = Date.UTC(2026, 9, 21);
  const minted = await server.waitlistClaimUrl({
    entryId: row.id,
    email: "Sam@Example.com",
    secret,
    origin: "https://drivereal.com",
    now,
    nonce,
  });
  check(minted?.href?.startsWith("https://drivereal.com/apply?claim="), "the claim url is an /apply claim link");
  const token = minted.href.split("claim=")[1];
  check(!token.includes("@") && !token.toLowerCase().includes("sam"), "the claim token does not carry the email");
  const opened = await server.verifyWaitlistClaim(token, secret, "sam@example.com", now);
  check(opened?.entryId === row.id && opened?.nonce === nonce, "the claim token round-trips for the applicant email");
  check((await server.verifyWaitlistClaim(token, secret, "other@example.com", now)) === null, "a claim token is bound to the applicant email");
  check((await server.verifyWaitlistClaim(token, secret, "  Sam@Example.com  ", now))?.entryId === row.id, "email binding ignores case and surrounding space");
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  check((await server.verifyWaitlistClaim(tampered, secret, row.email, now)) === null, "a tampered claim token is refused");
  check((await server.verifyWaitlistClaim(token, "other-secret", row.email, now)) === null, "a claim token from another secret is refused");
  check((await server.verifyWaitlistClaim(token, secret, row.email, Date.UTC(2026, 10, 21))) === null, "an expired claim token is refused");
  check((await server.waitlistClaimUrl({ entryId: row.id, email: row.email, secret: "" })) === null, "a missing secret does not invent a link");

  const serviceKey = "s".repeat(40);
  check(server.readClaimSecret({ SUPABASE_SERVICE_ROLE_KEY: serviceKey }) === null, "the service-role key is not a claim secret");
  check(server.readClaimSecret({ WAITLIST_CLAIM_SECRET: serviceKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey }) === null, "a claim secret copied from the service-role key is refused");
  check(server.readClaimSecret({ WAITLIST_CLAIM_SECRET: "short" }) === null, "a short claim secret fails closed");
  check(server.readClaimSecret({}) === null, "a missing claim secret fails closed");
  check(server.readClaimSecret({ WAITLIST_CLAIM_SECRET: "d".repeat(32), SUPABASE_SERVICE_ROLE_KEY: serviceKey }) === "d".repeat(32), "a dedicated claim secret is accepted");
  check(
    (await server.waitlistClaimUrl({
      entryId: row.id,
      email: row.email,
      secret: serviceKey,
      env: { SUPABASE_SERVICE_ROLE_KEY: serviceKey },
    })) === null,
    "signing refuses the service-role key even when it is passed in",
  );

  const tokenHash = await server.claimTokenHash(nonce);
  check(tokenHash === minted.tokenHash && tokenHash !== nonce, "the stored value is a hash of the nonce, not the nonce");
  const storedRow = {
    id: row.id,
    full_name: "Sam Rivera",
    email: "sam@example.com",
    phone: "5550100",
    city: "Austin",
    state: "TX",
    pickup_date: "2026-11-01",
    market_id: "m1",
    status: "notified",
    claim_token_hash: tokenHash,
  };
  function memoryStore(initial) {
    let current = initial;
    const loads = [];
    return {
      loads,
      store: {
        load: async (id) => {
          loads.push(id);
          return current && current.id === id ? { ...current } : null;
        },
        consume: async (id, hash) => {
          if (!current || current.id !== id || current.claim_token_hash !== hash) return null;
          if (current.status !== "waiting" && current.status !== "notified") return null;
          current = { ...current, claim_token_hash: null };
          return { ...current };
        },
      },
    };
  }
  const once = memoryStore(storedRow);
  const firstOpen = await server.openWaitlistClaim(once.store, token, secret, now);
  const secondOpen = await server.openWaitlistClaim(once.store, token, secret, now);
  check(firstOpen.ok === true && firstOpen.prefill.email === "sam@example.com", "the first open returns the prefill");
  check(secondOpen.ok === false, "a claim token is single-use");
  const wrongEmail = memoryStore({ ...storedRow, email: "other@example.com", claim_token_hash: tokenHash });
  const rebound = await server.openWaitlistClaim(wrongEmail.store, token, secret, now);
  check(rebound.ok === false && wrongEmail.store && wrongEmail.loads.length === 1, "an email change on the row invalidates the token");
  let consumedAfterMismatch = false;
  const mismatchStore = {
    load: async () => ({ ...storedRow, email: "other@example.com" }),
    consume: async () => {
      consumedAfterMismatch = true;
      return null;
    },
  };
  await server.openWaitlistClaim(mismatchStore, token, secret, now);
  check(consumedAfterMismatch === false, "a token for a different email does not consume the row");
  const noSecretLoads = [];
  const closed = await server.openWaitlistClaim(
    { load: async (id) => { noSecretLoads.push(id); return storedRow; }, consume: async () => storedRow },
    token,
    null,
    now,
  );
  check(closed.ok === false && noSecretLoads.length === 0, "a missing secret does not read the waitlist");

  const failedOn = await deliver(true, false, minted.href, tokenHash);
  check(failedOn.sentTo[0].html.includes(`claim=${token}`) && !failedOn.sentTo[0].html.includes("you stay at the top") && !failedOn.sentTo[0].html.includes("application you started"), "the enabled email carries the claim link and drops the old promise");
  check(failedOn.marked.length === 0 && failedOn.result.sent === 0, "a failed send does not mark Notified while the flag is on");

  const sentOn = await deliver(true, true, minted.href, tokenHash);
  check(sentOn.marked.length === 1 && sentOn.marked[0].hash === tokenHash && sentOn.result.sent === 1, "a successful send marks Notified with the token hash");

  const unmarked = await claim.deliverOpeningEmails({
    enabled: true,
    rows: [row],
    origin: "https://drivereal.com",
    companyPhone: "(555) 010-1000",
    claimUrl: async () => ({ href: minted.href, tokenHash }),
    send: async () => ({ ok: true }),
    markNotified: async () => false,
  });
  check(unmarked.sent === 0, "Notified is not counted when the hash write does not stick");

  const missing = await deliver(true, true, null);
  check(missing.sentTo.length === 0 && missing.marked.length === 0, "a missing claim link does not send and does not mark Notified");

  const dirty = "/apply?city=austin&claim=" + token + "&pickup=2026-11-01";
  check(claim.landingPageWithoutClaim(dirty) === "/apply?city=austin&pickup=2026-11-01", "a landing page keeps its other params and drops the claim token");
  check(claim.landingPageWithoutClaim("/apply") === "/apply", "a landing page without a claim token is unchanged");
  check(!String(claim.landingPageWithoutClaim(dirty)).includes("claim="), "the stored landing page does not contain the token");
  check(
    claim.landingPageWithoutClaim("https://drivereal.com/apply?claim=" + token) === "https://drivereal.com/apply",
    "an absolute landing page drops the claim token",
  );

  check(claim.comingSoonRateDecision({ emailAttempts: 5, ipAttempts: 1, ipKnown: true }).ok === true, "five Coming Soon attempts in the window are allowed");
  check(claim.comingSoonRateDecision({ emailAttempts: 6, ipAttempts: 1, ipKnown: true }).ok === false, "a sixth Coming Soon attempt for one email is refused");
  check(claim.comingSoonRateDecision({ emailAttempts: 1, ipAttempts: 21, ipKnown: true }).ok === false, "Coming Soon is refused past the address limit");
  check(claim.comingSoonRateDecision({ emailAttempts: 1, ipAttempts: 0, ipKnown: false }).ok === false, "Coming Soon without a client address fails closed");
  const limited = claim.comingSoonRateDecision({ emailAttempts: 6, ipAttempts: 21, ipKnown: false });
  check(limited.ok === false && limited.error === "Please try again later.", "a rate-limit refusal does not describe which check failed");

  const waiting = claim.claimPrefillFromRow({
    status: "waiting",
    full_name: "Sam Rivera",
    email: "sam@example.com",
    phone: "5550100",
    city: "Austin",
    state: "TX",
    pickup_date: "2026-11-01",
    market_id: "m1",
  });
  check(waiting.ok === true && waiting.prefill.email === "sam@example.com" && !("status" in waiting.prefill), "a waiting row prefills and does not return status");
  const promoted = claim.claimPrefillFromRow({
    status: "promoted",
    full_name: "Sam",
    email: "sam@example.com",
    phone: null,
    city: null,
    state: null,
    pickup_date: null,
    market_id: null,
  });
  check(promoted.ok === false && /application/.test(promoted.error), "a promoted row does not start another application");

  const functions = readFileSync("src/lib/waitlist.functions.ts", "utf8");
  const notify = functions.slice(functions.indexOf("export const notifyWaitlistTop"), functions.indexOf("export const readWaitlistClaim"));
  check(notify.includes("enabled: WAITLIST_CLAIM_ENABLED") && notify.includes("deliverOpeningEmails"), "notify passes the flag into the sender");
  check(notify.includes("await requireManager(context.userId)"), "notify stays Manager gated");
  const reader = functions.slice(functions.indexOf("export const readWaitlistClaim"), functions.indexOf("export const promoteToApplicant"));
  check(reader.indexOf("if (!WAITLIST_CLAIM_ENABLED)") < reader.indexOf("client.server"), "a disabled claim read returns before the database import");
  check(!reader.includes("issueResumeToken") && !reader.includes("promote_waitlist_entry") && !reader.includes("SUPABASE_SERVICE_ROLE_KEY"), "opening a claim does not promote, mint a resume token, or sign with the service-role key");
  const notifyMark = notify.slice(notify.indexOf("markNotified"));
  check(notifyMark.indexOf("if (!WAITLIST_CLAIM_ENABLED)") < notifyMark.indexOf("claim_token_hash"), "the live Notified stamp does not write the claim hash");
  check(notifyMark.includes("claim_token_hash: tokenHash"), "Notified stores the claim hash only on the flagged path");
  const joinSrc = functions.slice(functions.indexOf("export const joinWaitlist"), functions.indexOf("export type WaitlistEntry"));
  const gateAt = joinSrc.indexOf("enforceComingSoonRate");
  const insertAt = joinSrc.indexOf('.from("waitlist")');
  check(gateAt !== -1 && insertAt !== -1 && gateAt < insertAt, "Coming Soon is rate-limited before the waitlist read");
  check(joinSrc.includes('data.source === "homepage_waitlist"') && joinSrc.includes("WAITLIST_CLAIM_ENABLED"), "the Coming Soon limit is behind the claim flag");
  const conflict = functions.slice(functions.indexOf("phone conflict review"));
  check(!conflict.includes("WAITLIST_CLAIM_ENABLED"), "the conflict resolver does not read the claim flag");
  const dialog = readFileSync("src/components/admin/WaitlistConflictDialog.tsx", "utf8");
  check(!dialog.includes("WAITLIST_CLAIM_ENABLED"), "the conflict dialog is unchanged by the claim flag");

  const locations = readFileSync("src/components/site/LocationsSection.tsx", "utf8");
  check(locations.includes("comingSoonSignup(WAITLIST_CLAIM_ENABLED"), "Coming Soon uses the flagged signup helper");
  const apply = readFileSync("src/routes/apply.tsx", "utf8");
  check(apply.includes("applySearchKeys(WAITLIST_CLAIM_ENABLED)"), "/apply keeps claim off the search list until the flag is on");

  const serverSrc = readFileSync("src/lib/waitlist-claim.server.ts", "utf8");
  const claimSrc = readFileSync("src/lib/waitlist-claim.ts", "utf8");
  check(!serverSrc.includes("resume-tokens") && !serverSrc.includes("email.server") && !serverSrc.includes("node:crypto"), "the claim signer does not use resume tokens, mail, or node:crypto");
  check(!claimSrc.includes("email.server") && !claimSrc.includes("node:crypto"), "the claim helper does not send mail");
  check(serverSrc.includes("WAITLIST_CLAIM_SECRET") && !serverSrc.includes("SUPABASE_SERVICE_ROLE_KEY ??") && !serverSrc.includes("SUPABASE_SERVICE_ROLE_KEY ||"), "the signer names a dedicated secret and does not fall back to the service-role key");
  check(serverSrc.includes('update({ claim_token_hash: null })') && serverSrc.includes('.eq("claim_token_hash", tokenHash)'), "opening a claim clears the stored hash only when it still matches");
  check(serverSrc.includes('in("status", ["waiting", "notified"])'), "a consumed claim must still be waiting or notified");
  const attribution = readFileSync("src/lib/attribution.ts", "utf8");
  check(attribution.includes("landingPageWithoutClaim"), "attribution stores a landing page without the claim token");
  const apps = readFileSync("src/lib/applications.functions.ts", "utf8");
  check(apps.includes("landingPageWithoutClaim(insertFields.landing_page)"), "saving an application strips the claim token from landing_page");

  const proposed = readFileSync("proposed/waitlist-promote-skip-deleted-v1.sql", "utf8");
  check(proposed.includes("not a migration") && proposed.includes("must not be run") && proposed.includes("deleted_at IS NULL") && !/CREATE\s+OR\s+REPLACE/i.test(proposed), "option 5 is a proposed note and not a migration");
  check(!readdirSync("drizzle/migrations").some((name) => name.includes("waitlist-promote-skip-deleted")), "the proposal is not in drizzle migrations");
  check(!readdirSync("supabase/migrations").some((name) => name.includes("waitlist-promote-skip-deleted")), "the proposal is not in supabase migrations");
  const claimSql = readFileSync("proposed/waitlist-claim-token-v1.sql", "utf8");
  check(claimSql.includes("not a migration") && claimSql.includes("claim_token_hash") && claimSql.includes("REVOKE INSERT"), "the claim hash column is a proposed note with the public write revoked");
  check(!readdirSync("drizzle/migrations").some((name) => name.includes("waitlist-claim-token")), "the claim hash column is not in drizzle migrations");
  check(!readdirSync("supabase/migrations").some((name) => name.includes("waitlist-claim-token")), "the claim hash column is not in supabase migrations");

  console.log(`${passed} waitlist claim checks passed`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
