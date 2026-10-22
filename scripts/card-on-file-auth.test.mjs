import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const out = mkdtempSync(join(tmpdir(), "rr-card-on-file-"));
const APP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TOKEN = "resume-token-for-the-right-applicant-ok";
const returnUrl = `http://127.0.0.1:5199/card/${APP}?status=success`;

globalThis.__stripe = { clients: 0, customers: [], sessions: [] };
globalThis.__headers = {};
globalThis.__claims = { data: { claims: null }, error: null };
globalThis.__actors = {};
globalThis.__cardTokens = {};
globalThis.__customerUpdateError = null;
globalThis.__app = null;

const stub = {
  name: "card-stubs",
  setup(b) {
    const files = {
      "@tanstack/react-start": `
        export function createServerFn() {
          const api = {
            middleware() { return api; },
            inputValidator(fn) { api.validate = fn; return api; },
            handler(fn) { api.handle = fn; return api; },
          };
          return api;
        }
      `,
      "@tanstack/react-start/server": `
        export function getRequest() {
          return { headers: { get: (name) => globalThis.__headers[String(name).toLowerCase()] ?? null } };
        }
      `,
      "@/integrations/supabase/auth-middleware": `export const requireSupabaseAuth = {};`,
      "@/lib/stripe.server": `
        export function createStripeClient() {
          globalThis.__stripe.clients += 1;
          return {
            customers: { create: async (body, opts) => { globalThis.__stripe.customers.push({ body, opts }); return { id: "cus_new" }; } },
            checkout: { sessions: { create: async (body) => {
              if (globalThis.__stripeThrow) throw globalThis.__stripeThrow;
              globalThis.__stripe.sessions.push(body);
              return { client_secret: "cs_test_secret", id: "cs_sess", customer: body.customer, url: "https://checkout.stripe.test/secret" };
            } } },
          };
        }
        export function getStripeErrorMessage(error) { return error?.message || "Stripe request failed"; }
      `,
      "@/integrations/supabase/client.server": `
        export const supabaseAdmin = { from() {
          const chain = {
            select() { return chain; },
            eq() { return chain; },
            is() { return chain; },
            update() { chain.op = "update"; return chain; },
            maybeSingle: async () => {
              if (chain.op === "update" && globalThis.__customerUpdateError) {
                return { data: null, error: globalThis.__customerUpdateError };
              }
              return { data: globalThis.__app, error: null };
            },
          };
          return chain;
        } };
      `,
      "@/lib/resume-tokens.server": `
        export const CARD_LINK_MS = 72 * 60 * 60 * 1000;
        export async function resolveCardToken(_admin, raw) {
          const id = globalThis.__cardTokens[raw];
          if (!id || id === "expired") throw new Error("This link is no longer valid.");
          return id;
        }
        export async function issueResumeToken(_admin, _id, opts) {
          globalThis.__cardIssue = opts ?? null;
          if (opts?.purpose !== "card") throw new Error("card link required");
          if (opts.ttlMs != null) throw new Error("ttl");
          return "minted-card-token-value";
        }
        export function rememberedCardExpiry() {
          return globalThis.__cardExpiry === undefined ? 1800000000000 : globalThis.__cardExpiry;
        }
      `,
      "@/lib/roles.server": `
        export async function getActor(userId) { return globalThis.__actors[userId] ?? null; }
        export async function requireManager() { return { tier: "manager" }; }
      `,
      "@supabase/supabase-js": `
        export function createClient() {
          return { auth: { getClaims: async () => globalThis.__claims } };
        }
      `,
    };
    b.onResolve({ filter: /.*/ }, (args) => {
      if (files[args.path]) return { path: args.path, namespace: "stub" };
    });
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: files[args.path], loader: "js" }));
  },
};

await build({
  entryPoints: ["src/lib/payments.functions.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(out, "payments.mjs"),
  alias: { "@": resolve("src") },
  plugins: [stub],
});

const { createCardOnFileSession, issueCardOnFileLink, cardCustomerIdempotencyKey } = await import(pathToFileURL(join(out, "payments.mjs")).href);
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";

let passed = 0;
function ok(name) {
  passed += 1;
  console.log("PASS", name);
}

function reset() {
  globalThis.__stripe.clients = 0;
  globalThis.__stripe.customers = [];
  globalThis.__stripe.sessions = [];
  globalThis.__headers = {};
  globalThis.__claims = { data: { claims: null }, error: { message: "none" } };
  globalThis.__actors = {};
  globalThis.__cardTokens = {};
  globalThis.__customerUpdateError = null;
  globalThis.__stripeThrow = null;
  delete globalThis.__cardExpiry;
  process.env.NODE_ENV = "development";
  delete process.env.SITE_URL;
  globalThis.__app = {
    id: APP,
    user_id: "applicant-1",
    full_name: "Dana Reyes",
    email: "dana@example.com",
    phone: "555",
    stripe_customer_id: "cus_existing",
  };
}

const session = (extra = {}) => createCardOnFileSession.handle({
  data: { applicationId: APP, returnUrl, environment: "sandbox", ...extra },
});

reset();
assert.throws(() => createCardOnFileSession.validate({
  applicationId: "not-a-uuid",
  returnUrl,
  environment: "sandbox",
}), /Invalid application/);
assert.equal(globalThis.__stripe.clients, 0);
ok("an invalid id is rejected before Stripe");

reset();
const anon = await session();
assert.equal(anon.error, "This link is no longer valid. Ask us for a new one and we'll send it over.");
assert.equal(globalThis.__stripe.clients, 0);
assert.equal("clientSecret" in anon, false);
ok("an unauthenticated request is refused before any Stripe call");

reset();
globalThis.__cardTokens[TOKEN] = OTHER;
const wrong = await session({ token: TOKEN });
assert.equal(wrong.error?.includes("no longer valid"), true);
assert.equal(globalThis.__stripe.clients, 0);
ok("the wrong applicant is refused before any Stripe call");

reset();
globalThis.__headers.authorization = "Bearer applicant-token";
globalThis.__claims = { data: { claims: { sub: "someone-else" } }, error: null };
globalThis.__actors["someone-else"] = null;
const wrongUser = await session();
assert.equal(wrongUser.error?.includes("no longer valid"), true);
assert.equal(globalThis.__stripe.clients, 0);
ok("a signed-in applicant cannot open somebody else's application");

reset();
globalThis.__cardTokens[TOKEN] = APP;
const right = await session({ token: TOKEN });
assert.deepEqual(Object.keys(right), ["clientSecret"]);
assert.equal(right.clientSecret, "cs_test_secret");
assert.equal(globalThis.__stripe.clients, 1);
assert.equal(globalThis.__stripe.customers.length, 0);
assert.equal(globalThis.__stripe.sessions[0].customer, "cus_existing");
assert.equal(JSON.stringify(right).includes("cus_"), false);
assert.equal(JSON.stringify(right).includes("dana@example.com"), false);
ok("the correct applicant reuses the existing customer and receives only the client secret");

reset();
globalThis.__app.stripe_customer_id = null;
globalThis.__cardTokens[TOKEN] = APP;
const created = await session({ token: TOKEN });
assert.equal(created.clientSecret, "cs_test_secret");
assert.equal(globalThis.__stripe.customers.length, 1);
const sameParams = { email: "dana@example.com", name: "Dana Reyes", phone: "555" };
const expectedKey = await cardCustomerIdempotencyKey(APP, sameParams);
assert.equal(globalThis.__stripe.customers[0].opts.idempotencyKey, expectedKey);
assert.match(expectedKey, new RegExp(`^card-on-file-customer:${APP}:[0-9a-f]{64}$`));
assert.notEqual(expectedKey, `card-on-file-customer:${APP}`);
assert.equal(globalThis.__stripe.sessions[0].customer, "cus_new");
assert.equal(JSON.stringify(created).includes("cus_new"), false);
ok("a first card setup creates one customer with a stable idempotency key");

assert.equal(await cardCustomerIdempotencyKey(APP, sameParams), expectedKey);
assert.notEqual(await cardCustomerIdempotencyKey(APP, { ...sameParams, email: "dana.reyes@example.com" }), expectedKey);
assert.notEqual(await cardCustomerIdempotencyKey(APP, { ...sameParams, name: "Dana R. Reyes" }), expectedKey);
assert.notEqual(await cardCustomerIdempotencyKey(APP, { ...sameParams, phone: "556" }), expectedKey);
const CHANGED = "44444444-4444-4444-8444-444444444444";
globalThis.__cardTokens[TOKEN] = CHANGED;
globalThis.__app.email = "dana.reyes@example.com";
globalThis.__stripe.customers = [];
const changed = await createCardOnFileSession.handle({
  data: {
    applicationId: CHANGED,
    returnUrl: `http://127.0.0.1:5199/card/${CHANGED}?status=success`,
    environment: "sandbox",
    token: TOKEN,
  },
});
assert.equal(changed.clientSecret, "cs_test_secret");
assert.equal(
  globalThis.__stripe.customers[0].opts.idempotencyKey,
  await cardCustomerIdempotencyKey(APP, { email: "dana.reyes@example.com", name: "Dana Reyes", phone: "555" }),
);
assert.notEqual(globalThis.__stripe.customers[0].opts.idempotencyKey, expectedKey);
ok("a changed email, name, or phone gets a new customer idempotency key");

reset();
globalThis.__headers.authorization = "Bearer manager-token";
globalThis.__claims = { data: { claims: { sub: "manager-1" } }, error: null };
globalThis.__actors["manager-1"] = { userId: "manager-1", tier: "manager" };
const manager = await session();
assert.equal(manager.clientSecret, "cs_test_secret");
assert.equal(globalThis.__stripe.sessions[0].customer, "cus_existing");
ok("a manager can open the card setup");

reset();
globalThis.__actors["owner-1"] = { userId: "owner-1", tier: "owner" };
globalThis.__headers.authorization = "Bearer owner-token";
globalThis.__claims = { data: { claims: { sub: "owner-1" } }, error: null };
const owner = await session();
assert.equal(owner.clientSecret, "cs_test_secret");
ok("an owner is allowed through the manager path");

reset();
globalThis.__actors["coord-1"] = { userId: "coord-1", tier: "coordinator" };
globalThis.__headers.authorization = "Bearer coord-token";
globalThis.__claims = { data: { claims: { sub: "coord-1" } }, error: null };
globalThis.__app.user_id = "not-the-coordinator";
const coord = await session();
assert.equal(coord.error?.includes("no longer valid"), true);
assert.equal(globalThis.__stripe.clients, 0);
ok("a coordinator is not a manager and cannot open another applicant's card");

reset();
globalThis.__headers.authorization = "Bearer manager-token";
globalThis.__claims = { data: { claims: { sub: "manager-1" } }, error: null };
globalThis.__actors["manager-1"] = { userId: "manager-1", tier: "manager" };
const leaked = await session({ returnUrl: `https://evil.example/card/${APP}?status=success` });
assert.equal(leaked.error?.includes("no longer valid"), true);
assert.equal(globalThis.__stripe.clients, 0);
ok("a return URL on another site is refused before Stripe");

reset();
process.env.NODE_ENV = "production";
globalThis.__headers.authorization = "Bearer manager-token";
globalThis.__claims = { data: { claims: { sub: "manager-1" } }, error: null };
globalThis.__actors["manager-1"] = { userId: "manager-1", tier: "manager" };
const localProd = await session();
assert.equal(localProd.error?.includes("no longer valid"), true);
assert.equal(globalThis.__stripe.clients, 0);
const www = await session({ returnUrl: `https://www.drivereal.com/card/${APP}?status=success` });
assert.equal(www.clientSecret, "cs_test_secret");
const apex = await session({ returnUrl: `https://drivereal.com/card/${APP}?status=success` });
assert.equal(apex.clientSecret, "cs_test_secret");
process.env.SITE_URL = "https://preview.example.com";
const derived = await session({ returnUrl: `https://www.preview.example.com/card/${APP}?status=success` });
assert.equal(derived.clientSecret, "cs_test_secret");
const stillLocal = await session({ returnUrl: `http://localhost:3000/card/${APP}?status=success` });
assert.equal(stillLocal.error?.includes("no longer valid"), true);
process.env.NODE_ENV = "development";
delete process.env.SITE_URL;
ok("production allows www and SITE_URL and refuses localhost");

reset();
globalThis.__cardTokens[TOKEN] = APP;
globalThis.__app.stripe_customer_id = null;
globalThis.__customerUpdateError = { message: "conditional update lost the race" };
const logged = [];
const originalError = console.error;
console.error = (...args) => logged.push(args.map(String).join(" "));
try {
  const saved = await session({ token: TOKEN });
  assert.equal(saved.clientSecret, "cs_test_secret");
} finally {
  console.error = originalError;
}
assert.equal(logged.some((line) => line.includes("stripe_customer_id update failed") && line.includes("conditional update lost the race")), true);
assert.equal(globalThis.__stripe.customers.length, 1);
ok("a failed customer-id update is logged and the setup still returns only the client secret");

reset();
const resumeShaped = await session({ token: "this-is-a-resume-token-not-a-card-link" });
assert.equal(resumeShaped.error?.includes("no longer valid"), true);
assert.equal(globalThis.__stripe.clients, 0);
ok("a resume token is not a card link");

const LINK = "This link is no longer valid. Ask us for a new one and we'll send it over.";

reset();
const badToken = await session({ token: "card.bogus-token-value-ok" });
assert.equal(badToken.error, LINK);
assert.equal("clientSecret" in badToken, false);
assert.equal(globalThis.__stripe.clients, 0);
assert.equal(globalThis.__stripe.customers.length, 0);
assert.equal(globalThis.__stripe.sessions.length, 0);
ok("a bad card token is refused before any Stripe call");

reset();
globalThis.__cardTokens[TOKEN] = "expired";
const expiredToken = await session({ token: TOKEN });
assert.equal(expiredToken.error, LINK);
assert.equal("clientSecret" in expiredToken, false);
assert.equal(globalThis.__stripe.clients, 0);
assert.equal(globalThis.__stripe.customers.length, 0);
assert.equal(globalThis.__stripe.sessions.length, 0);
ok("an expired card token is refused before any Stripe call");

reset();
globalThis.__cardIssue = null;
const issued = await issueCardOnFileLink.handle({
  data: { applicationId: APP },
  context: { userId: "manager-1" },
});
assert.deepEqual(globalThis.__cardIssue, { purpose: "card" });
assert.equal(issued.path, `/card/${APP}?t=${encodeURIComponent("minted-card-token-value")}`);
assert.equal(issued.expiresAt, 1800000000000);
ok("a staff card link does not pass a lifetime");

const SETUP_ERROR = "Could not start the card setup. Ask us for a new link and we'll send it over.";
const ERR_APP = "33333333-3333-4333-8333-333333333333";
const errorSession = () => createCardOnFileSession.handle({
  data: {
    applicationId: ERR_APP,
    returnUrl: `http://127.0.0.1:5199/card/${ERR_APP}?status=success`,
    environment: "sandbox",
    token: TOKEN,
  },
});

reset();
globalThis.__cardTokens[TOKEN] = ERR_APP;
globalThis.__stripeThrow = { type: "StripeCardError", message: "Your card was declined." };
const declined = await errorSession();
assert.equal(declined.error, "Your card was declined.");
ok("a Stripe card-setup error keeps Stripe's own message");

reset();
globalThis.__cardTokens[TOKEN] = ERR_APP;
globalThis.__stripeThrow = { type: "StripeAuthenticationError", message: "Invalid API Key provided: sk_live_abc123" };
const secret = await errorSession();
assert.equal(secret.error, SETUP_ERROR);
assert.equal(String(secret.error).includes("sk_live_"), false);
ok("a Stripe message that names a key stays generic");

reset();
globalThis.__cardTokens[TOKEN] = ERR_APP;
globalThis.__stripeThrow = new Error("STRIPE_LIVE_API_KEY is not configured");
const configError = await errorSession();
assert.equal(configError.error, SETUP_ERROR);
assert.equal(String(configError.error).includes("STRIPE_LIVE_API_KEY"), false);
ok("a non-Stripe setup failure stays generic");

reset();
globalThis.__cardExpiry = null;
await assert.rejects(
  () => issueCardOnFileLink.handle({ data: { applicationId: APP }, context: { userId: "manager-1" } }),
  /Could not prepare the card link/,
);
ok("a card link without an expiry is not returned");

rmSync(out, { recursive: true, force: true });
console.log(`${passed} card-on-file checks passed`);
