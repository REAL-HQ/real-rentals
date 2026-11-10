// Initial payment amount. No Stripe calls. Run: npx tsx scripts/initial-payment.test.ts
import { readFileSync } from "node:fs";
import { initialPaymentFromMerge } from "../src/lib/initial-payment";
import { checkoutStripeEnv } from "../src/lib/initial-payment.server";

let fail = 0;
const ok = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fail++; };

console.log("AMOUNT IS THE PRINTED WEEK PLUS THE PRINTED DEPOSIT");
let a = initialPaymentFromMerge({ weekly_rate: "$350.00", deposit_amount: "$500.00" });
ok(a?.rent === 350 && a.deposit === 500 && a.total === 850, "350 + 500 = 850");
ok(a?.label === "the first week's rent plus the security deposit", "the email names both parts");
a = initialPaymentFromMerge({ weekly_rate: "$1,200.50", deposit_amount: "$0" });
ok(a?.total === 1200.5 && a.deposit === 0 && a.label === "the first week's rent", "a zero deposit adds nothing");
ok(initialPaymentFromMerge({ weekly_rate: "", deposit_amount: "$500" }) == null, "no weekly rate means no link");
ok(initialPaymentFromMerge({ weekly_rate: "$0.25", deposit_amount: "$0" }) == null, "below the card minimum means no link");
ok(initialPaymentFromMerge({ weekly_rate: "not money", deposit_amount: "$10" }) == null, "an unreadable rate means no link");

console.log("NO STRIPE CALL UNLESS AN ENVIRONMENT IS ACTUALLY CONFIGURED");
const saved = {
  lovable: process.env.LOVABLE_API_KEY,
  forced: process.env.STRIPE_CHECKOUT_ENV,
  sandbox: process.env.STRIPE_SANDBOX_API_KEY,
  live: process.env.STRIPE_LIVE_API_KEY,
  pk: process.env.VITE_PAYMENTS_CLIENT_TOKEN,
  pk2: process.env.PAYMENTS_CLIENT_TOKEN,
};
delete process.env.LOVABLE_API_KEY;
delete process.env.STRIPE_CHECKOUT_ENV;
delete process.env.STRIPE_SANDBOX_API_KEY;
delete process.env.STRIPE_LIVE_API_KEY;
delete process.env.VITE_PAYMENTS_CLIENT_TOKEN;
delete process.env.PAYMENTS_CLIENT_TOKEN;
ok(checkoutStripeEnv() === null, "missing keys do not pick an environment");
process.env.LOVABLE_API_KEY = "present";
process.env.VITE_PAYMENTS_CLIENT_TOKEN = "pk_live_example";
ok(checkoutStripeEnv() === null, "a live publishable key without the live secret does not call Stripe");
process.env.STRIPE_CHECKOUT_ENV = "sandbox";
process.env.STRIPE_SANDBOX_API_KEY = "sk_test_example";
ok(checkoutStripeEnv() === "sandbox", "an explicit sandbox with its key is sandbox");
for (const [k, v] of Object.entries({
  LOVABLE_API_KEY: saved.lovable,
  STRIPE_CHECKOUT_ENV: saved.forced,
  STRIPE_SANDBOX_API_KEY: saved.sandbox,
  STRIPE_LIVE_API_KEY: saved.live,
  VITE_PAYMENTS_CLIENT_TOKEN: saved.pk,
  PAYMENTS_CLIENT_TOKEN: saved.pk2,
})) {
  if (v == null) delete process.env[k];
  else process.env[k] = v;
}

console.log("THE LINK IS ON THE SIGNED EMAIL, AND A FAILURE DOES NOT UN-SIGN");
const email = readFileSync("src/lib/email.server.ts", "utf8");
const agreements = readFileSync("src/lib/agreements.functions.ts", "utf8");
const server = readFileSync("src/lib/initial-payment.server.ts", "utf8");
ok(/payment\?:/.test(email) && /Pay \$\{amount\}/.test(email), "the signed email can carry a pay button");
const signing = email.slice(email.indexOf("export async function sendAgreementEmail"), email.indexOf("export async function sendAgreementSignedEmail"));
ok(!/payment/i.test(signing), "the signing email is unchanged");
ok(/createInitialPaymentLink/.test(agreements) && /initial payment link failed/.test(agreements), "signing still finishes when the link cannot be created");
ok(server.includes('type: "deposit"') && server.includes('type: "rent"') && server.includes("paymentIds"), "rent and deposit are separate charges the existing webhook can mark paid");
ok(server.includes('status: "void"') && server.includes("initial_payment_link"), "a checkout that does not happen voids its rows and can fall back to the shared page");
ok(server.includes("tiedToRenter: false"), "the shared page is labeled as not tied to this renter");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
