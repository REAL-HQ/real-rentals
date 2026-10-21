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
    !claim.applySearchKeys(true).includes("claim") && claim.applySearchKeys(true).includes("t"),
    "the claim token is not an /apply search key, so it cannot reuse the resume token",
  );
  check(claim.landingPageWithoutClaim("/apply?claim=abc&city=Austin#top") === "/apply?city=Austin#top", "a claim query is stripped and the other hash stays");
  check(claim.landingPageWithoutClaim("https://drivereal.com/apply?city=Austin#claim=abc.1.ff") === "https://drivereal.com/apply?city=Austin", "a claim fragment is stripped from an absolute url");
  check(claim.landingPageWithoutClaim("https://other.example/start?claim=abc&utm_source=ad") === "https://other.example/start?utm_source=ad", "a referrer loses its claim query");
  check(claim.landingPageWithoutClaim("/apply?reclaim=keep&claim=drop") === "/apply?reclaim=keep", "reclaim= is not the claim key");
  check(claim.landingPageWithoutClaim("/apply#top&claim=drop") === "/apply#top", "a claim fragment beside another hash is removed");
  check(claim.landingPageWithoutClaim("https://drivereal.com/apply#reclaim=keep") === "https://drivereal.com/apply#reclaim=keep", "a reclaim fragment stays");
  check(claim.claimTokenFromUrl("?reclaim=1&claim=abc", "#reclaim=2") === "abc", "the claim reader ignores reclaim=");
  check(claim.claimTokenFromUrl("", "#reclaim=nope") === null, "a reclaim fragment is not a claim token");

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
  const stillInserted = claim.comingSoonSignup(true, { ...plain, phone: "5550100", driver_status: "active" });
  check(stillInserted.mode === "insert" && stillInserted.row.driver_status === "active" && stillInserted.row.phone === "5550100" && stillInserted.row.source === "homepage_waitlist", "Coming Soon stays a browser insert with driver status when the flag is on");
  check(claim.claimLandingPath("https://drivereal.com/apply?claim=abc.1.ff&city=Austin&utm_source=ad") === "/apply?city=Austin&utm_source=ad", "claim is removed before landing_page keeps the other parameters");
  check(claim.claimLandingPath("https://drivereal.com/apply?claim=only") === "/apply", "a claim-only url becomes /apply");

  const row = { id: "11111111-1111-4111-8111-111111111111", full_name: "Sam Rivera", email: "sam@example.com", city: "Austin" };
  const secret = "0123456789abcdef0123456789abcdef";
  async function deliver(enabled, sendOk, claimHref, markOk) {
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
        return claimHref;
      },
      send: async (message) => {
        sentTo.push(message);
        return { ok: sendOk };
      },
      markNotified: async (id) => {
        marked.push(id);
        return markOk;
      },
    });
    return { result, sentTo, marked, claimCalls };
  }

  const failedOff = await deliver(false, false, "https://drivereal.com/apply?claim=nope");
  check(failedOff.claimCalls === 0, "the disabled send does not build a claim link");
  check(failedOff.sentTo.length === 1 && failedOff.sentTo[0].html === golden, "a mocked failed send still uses the current email");
  check(failedOff.marked.length === 1 && failedOff.result.sent === 0, "a failed send still marks Notified while the flag is off");

  const issuedAt = Date.UTC(2026, 9, 21);
  const nonce = "a".repeat(64);
  const link = await server.waitlistClaimUrl({ entryId: row.id, email: "  Sam@Example.com ", secret, origin: "https://drivereal.com", now: issuedAt, nonce });
  check(link?.href.startsWith("https://drivereal.com/apply#claim="), "the claim url is an /apply fragment, not a query param");
  check(!link.href.includes("?") && !link.href.includes("@") && !link.href.toLowerCase().includes("sam"), "the fragment does not carry the email");
  const token = link.href.split("#claim=")[1];
  check(link.tokenHash !== nonce && link.tokenHash.length === 64, "the stored value is a hash of the nonce, not the nonce");
  const opened = await server.verifyWaitlistClaim(token, secret, "sam@example.com", issuedAt);
  check(opened?.entryId === row.id && opened.tokenHash === link.tokenHash, "the claim token round-trips for the trimmed lower-case email");
  check((await server.verifyWaitlistClaim(token, secret, "other@example.com", issuedAt)) === null, "a changed email does not match the signature");
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  check((await server.verifyWaitlistClaim(tampered, secret, row.email, issuedAt)) === null, "a tampered claim token is refused");
  check((await server.verifyWaitlistClaim(token, secret, row.email, issuedAt + 72 * 60 * 60 * 1000)) === null, "a claim token expires at 72 hours");
  check((await server.verifyWaitlistClaim(token, secret, row.email, issuedAt + 71 * 60 * 60 * 1000))?.entryId === row.id, "a claim token is still valid inside 72 hours");
  check(server.readClaimSecret({ WAITLIST_CLAIM_SECRET: secret }) === secret, "a dedicated 32-character secret is accepted");
  check(server.readClaimSecret({}) === null, "a missing WAITLIST_CLAIM_SECRET fails closed");
  check(server.readClaimSecret({ WAITLIST_CLAIM_SECRET: "short-secret" }) === null, "a short WAITLIST_CLAIM_SECRET fails closed");
  check(server.readClaimSecret({ WAITLIST_CLAIM_SECRET: secret, SUPABASE_SERVICE_ROLE_KEY: secret }) === null, "a secret equal to the service-role key fails closed");
  check((await server.waitlistClaimUrl({ entryId: row.id, email: row.email, secret: "" })) === null, "a missing secret does not invent a link");
  check((await server.waitlistClaimUrl({ entryId: row.id, email: row.email, secret, env: { SUPABASE_SERVICE_ROLE_KEY: secret } })) === null, "the signer refuses the service-role key");
  check((await server.waitlistClaimUrl({ entryId: row.id, email: row.email, env: {} })) === null, "a missing WAITLIST_CLAIM_SECRET does not invent a link");

  const prefillRow = {
    id: row.id,
    status: "waiting",
    full_name: "Sam Rivera",
    email: "sam@example.com",
    phone: "5550100",
    city: "Austin",
    state: "TX",
    pickup_date: "2026-11-01",
    market_id: "m1",
    claim_token_hash: link.tokenHash,
  };
  function memoryStore(seed) {
    let hash = seed.claim_token_hash;
    const calls = { loads: 0, consumes: 0 };
    return {
      calls,
      async load(id) {
        calls.loads += 1;
        if (id !== seed.id) return { row: null };
        return { row: { ...seed, claim_token_hash: hash } };
      },
      async consume(_id, tokenHash) {
        calls.consumes += 1;
        if (hash !== tokenHash) return false;
        hash = null;
        return true;
      },
    };
  }
  const once = memoryStore(prefillRow);
  const first = await server.openWaitlistClaim(once, token, secret, issuedAt);
  const second = await server.openWaitlistClaim(once, token, secret, issuedAt);
  check(first.ok === true && first.prefill.email === "sam@example.com", "the first open prefills the applicant");
  check(second.ok === false && once.calls.consumes === 1, "the second open does not consume the hash again");
  const otherEmail = memoryStore({ ...prefillRow, email: "other@example.com" });
  const refused = await server.openWaitlistClaim(otherEmail, token, secret, issuedAt);
  check(refused.ok === false && otherEmail.calls.consumes === 0, "an email mismatch does not consume the hash");
  let loaded = false;
  const closed = await server.openWaitlistClaim({
    async load() { loaded = true; return { error: true }; },
    async consume() { return true; },
  }, token, "", issuedAt);
  check(closed.ok === false && loaded === false, "a missing secret does not read the waitlist");
  const missingColumn = await server.openWaitlistClaim({
    async load() { return { error: true }; },
    async consume() { throw new Error("consume"); },
  }, token, secret, issuedAt);
  check(missingColumn.ok === false, "a missing claim_token_hash column fails closed");

  const failedOn = await deliver(true, false, link);
  check(failedOn.sentTo[0].html.includes(`#claim=${token}`) && !failedOn.sentTo[0].html.includes("?claim=") && !failedOn.sentTo[0].html.includes("you stay at the top") && !failedOn.sentTo[0].html.includes("application you started"), "the enabled email carries the claim fragment and drops the old promise");
  check(failedOn.marked.length === 0 && failedOn.result.sent === 0, "a failed send does not mark Notified while the flag is on");

  const sentOn = await deliver(true, true, link);
  check(sentOn.marked.length === 1 && sentOn.result.sent === 1, "a successful send marks Notified while the flag is on");

  const missing = await deliver(true, true, null);
  check(missing.sentTo.length === 0 && missing.marked.length === 0, "a missing claim link does not send and does not mark Notified");
  const unmarked = await deliver(true, true, link, false);
  check(unmarked.marked.length === 1 && unmarked.result.sent === 0, "a hash write that does not match does not count as sent");

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
  const removed = claim.claimPrefillFromRow({ ...waiting.prefill, status: "deleted" });
  check(removed.ok === false, "a deleted row does not prefill");
  const other = claim.claimPrefillFromRow({ ...waiting.prefill, status: "closed" });
  check(other.ok === false, "a row that is no longer waiting or notified does not prefill");

  const functions = readFileSync("src/lib/waitlist.functions.ts", "utf8");
  const notify = functions.slice(functions.indexOf("export const notifyWaitlistTop"), functions.indexOf("export const readWaitlistClaim"));
  check(notify.includes("enabled: WAITLIST_CLAIM_ENABLED") && notify.includes("deliverOpeningEmails"), "notify passes the flag into the sender");
  check(notify.includes("await requireManager(context.userId)"), "notify stays Manager gated");
  const reader = functions.slice(functions.indexOf("export const readWaitlistClaim"), functions.indexOf("export const promoteToApplicant"));
  check(reader.indexOf("if (!WAITLIST_CLAIM_ENABLED)") < reader.indexOf("client.server"), "a disabled claim read returns before the database import");
  check(reader.indexOf("readClaimSecret()") < reader.indexOf("client.server"), "a missing claim secret returns before the database import");
  check(reader.includes("openWaitlistClaim"), "the claim read checks the row email and clears the nonce hash before it prefills");
  check(!reader.includes("SUPABASE_SERVICE_ROLE_KEY"), "the claim read does not use the service role key as a signing secret");
  check(!reader.includes("issueResumeToken") && !reader.includes("promote_waitlist_entry"), "opening a claim does not promote or mint a resume token");
  const markedOff = notify.slice(notify.indexOf("if (!WAITLIST_CLAIM_ENABLED)"), notify.indexOf("if (!tokenHash)"));
  check(!markedOff.includes("claim_token_hash"), "flag-off Notified does not write the hash column");
  const conflict = functions.slice(functions.indexOf("phone conflict review"));
  check(!conflict.includes("WAITLIST_CLAIM_ENABLED"), "the conflict resolver does not read the claim flag");
  const dialog = readFileSync("src/components/admin/WaitlistConflictDialog.tsx", "utf8");
  check(!dialog.includes("WAITLIST_CLAIM_ENABLED"), "the conflict dialog is unchanged by the claim flag");

  const locations = readFileSync("src/components/site/LocationsSection.tsx", "utf8");
  check(locations.includes("comingSoonSignup(false"), "Coming Soon always builds the browser insert");
  check(!locations.includes("joinWaitlist") && !locations.includes("useServerFn"), "Coming Soon does not call joinWaitlist");
  const apply = readFileSync("src/routes/apply.tsx", "utf8");
  check(apply.includes("applySearchKeys(WAITLIST_CLAIM_ENABLED)"), "/apply keeps claim off the search list until the flag is on");
  const claimEffect = apply.slice(apply.indexOf("useEffect(() => {"), apply.indexOf("return ("));
  check(claimEffect.indexOf("landingPageWithoutClaim") < claimEffect.indexOf("readClaim("), "claim is stripped before the claim read");
  check(claimEffect.includes("removeItem(CLAIM_STASH)") && claimEffect.indexOf("removeItem(CLAIM_STASH)") < claimEffect.indexOf("readClaim("), "a disabled visit clears a leftover claim stash");
  check(claimEffect.includes("window.history.replaceState") && !claimEffect.includes("pushState"), "stripping claim replaces history");
  check(apply.includes("WAITLIST_CLAIM_ENABLED ? [{ children: STRIP_CLAIM_SCRIPT }]") && apply.includes("(?:^|[?&])claim=") && apply.includes("(?:^|[#&])claim="), "the head script is flag-gated and matches only a claim key");
  check(!apply.includes("page_location") && !apply.includes("dataLayer") && !apply.includes("gtag(") && !apply.includes('search.indexOf("claim=")') && !apply.includes('hash.indexOf("#claim=")'), "the route does not set the Google tag page location or treat reclaim as claim");
  check(!readFileSync("src/routes/__root.tsx", "utf8").includes("claim"), "the Google tag in the root shell is untouched");
  check(!readFileSync("src/lib/attribution.ts", "utf8").includes("landingPageWithoutClaim"), "attribution is left to the live hotfix");

  const serverSrc = readFileSync("src/lib/waitlist-claim.server.ts", "utf8");
  const claimSrc = readFileSync("src/lib/waitlist-claim.ts", "utf8");
  check(!serverSrc.includes("resume-tokens") && !serverSrc.includes("email.server") && !serverSrc.includes("node:crypto"), "the claim signer does not use resume tokens, mail, or node:crypto");
  check(serverSrc.includes("WAITLIST_CLAIM_SECRET") && serverSrc.includes("SUPABASE_SERVICE_ROLE_KEY") && !serverSrc.includes("?? process.env.SUPABASE_SERVICE_ROLE_KEY") && !serverSrc.includes("?? env.SUPABASE_SERVICE_ROLE_KEY"), "the signer names the service-role key only to refuse it");
  check(serverSrc.includes("normalizeClaimEmail") && serverSrc.includes("claimTokenHash"), "the signature covers the normalized email and the stored value is the nonce hash");
  check(!claimSrc.includes("email.server") && !claimSrc.includes("node:crypto"), "the claim helper does not send mail");

  const proposed = readFileSync("proposed/waitlist-promote-skip-deleted-v1.sql", "utf8");
  check(proposed.includes("not a migration") && proposed.includes("must not be run") && proposed.includes("deleted_at IS NULL") && !/CREATE\s+OR\s+REPLACE/i.test(proposed), "option 5 is a proposed note and not a migration");
  const tokenSql = readFileSync("proposed/waitlist-claim-token-v1.sql", "utf8");
  check(tokenSql.includes("not a migration") && tokenSql.includes("must not be run") && tokenSql.includes("claim_token_hash") && tokenSql.includes("WAITLIST_CLAIM_SECRET"), "the hash column is proposed and names the dedicated secret");
  const insertGrant = tokenSql.match(/GRANT INSERT \(([^)]+)\)/)?.[1] ?? "";
  const updateGrant = tokenSql.match(/GRANT UPDATE \(([^)]+)\)/)?.[1] ?? "";
  check(tokenSql.includes("REVOKE INSERT, UPDATE ON public.waitlist FROM anon, authenticated") && !tokenSql.includes("REVOKE INSERT (claim_token_hash)") && insertGrant.includes("email") && !insertGrant.split(",").map((part) => part.trim()).includes("claim_token_hash") && !updateGrant.split(",").map((part) => part.trim()).includes("claim_token_hash"), "the hash column is withheld with column grants, not a column revoke");
  const rateSql = readFileSync("proposed/waitlist-coming-soon-rate-v1.sql", "utf8");
  check(rateSql.includes("Owner decision") && rateSql.includes("must not be run") && rateSql.includes("homepage_waitlist") && rateSql.includes("email-only") && rateSql.includes("SECURITY DEFINER") && rateSql.includes("SET search_path = public") && rateSql.includes("pg_advisory_xact_lock") && rateSql.includes("waitlist_coming_soon_email_created_idx"), "the Coming Soon rate limit is proposed SQL, email-only, and an owner decision");
  const appSrc = readFileSync("src/lib/applications.functions.ts", "utf8");
  check(appSrc.includes("landing_page: landingPageWithoutClaim(insertFields.landing_page)") && appSrc.includes("referrer: landingPageWithoutClaim(insertFields.referrer)"), "the server strips claim from landing_page and referrer");
  check(!functions.includes("waitlist_coming_soon_email_limit") && !appSrc.includes("waitlist_coming_soon_email_limit"), "the app does not call the proposed rate limit");
  check(!readdirSync("drizzle/migrations").some((name) => name.includes("waitlist-claim") || name.includes("coming-soon-rate")), "the proposals are not in drizzle migrations");
  check(!readdirSync("supabase/migrations").some((name) => name.includes("waitlist-claim") || name.includes("coming-soon-rate")), "the proposals are not in supabase migrations");

  console.log(`${passed} waitlist claim checks passed`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
