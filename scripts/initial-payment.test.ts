/**
 * Initial payment amount and the rule that Checkout is never called without keys.
 * Run: npx tsx scripts/initial-payment.test.ts
 */
import { readFileSync } from "node:fs";
import { initialPaymentFromMerge } from "../src/lib/initial-payment";
import { checkoutStripeEnv } from "../src/lib/initial-payment.server";

let fail = 0;
const ok = (cond: boolean, label: string) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
};

const both = initialPaymentFromMerge({ weekly_rate: "$329.00", deposit_amount: "$500.00" });
ok(both?.rent === 329 && both.deposit === 500 && both.total === 829, "rent plus a printed deposit");
ok(
  initialPaymentFromMerge({ weekly_rate: "$329.00", deposit_amount: "$0.00" })?.total === 329,
  "a zero deposit is not added",
);
ok(
  initialPaymentFromMerge({ weekly_rate: "", deposit_amount: "$0" }) == null,
  "an unreadable rate creates no charge",
);

const saved = {
  STRIPE_CHECKOUT_ENV: process.env.STRIPE_CHECKOUT_ENV,
  STRIPE_SANDBOX_API_KEY: process.env.STRIPE_SANDBOX_API_KEY,
  STRIPE_LIVE_API_KEY: process.env.STRIPE_LIVE_API_KEY,
  LOVABLE_API_KEY: process.env.LOVABLE_API_KEY,
  VITE_PAYMENTS_CLIENT_TOKEN: process.env.VITE_PAYMENTS_CLIENT_TOKEN,
  PAYMENTS_CLIENT_TOKEN: process.env.PAYMENTS_CLIENT_TOKEN,
};
function restore() {
  for (const [k, v] of Object.entries(saved)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
}
delete process.env.STRIPE_CHECKOUT_ENV;
delete process.env.STRIPE_SANDBOX_API_KEY;
delete process.env.STRIPE_LIVE_API_KEY;
delete process.env.LOVABLE_API_KEY;
delete process.env.VITE_PAYMENTS_CLIENT_TOKEN;
delete process.env.PAYMENTS_CLIENT_TOKEN;
ok(checkoutStripeEnv() == null, "no keys means no Stripe call");
process.env.STRIPE_CHECKOUT_ENV = "live";
process.env.STRIPE_LIVE_API_KEY = "sk_test_placeholder";
ok(checkoutStripeEnv() == null, "a secret without the gateway key is not enough");
process.env.LOVABLE_API_KEY = "gateway";
ok(checkoutStripeEnv() === "live", "live is used only when that env and both keys are set");
restore();

const src = readFileSync("src/lib/initial-payment.server.ts", "utf8");
const email = readFileSync("src/lib/email.server.ts", "utf8");
const signed = email.slice(
  email.indexOf("export async function sendAgreementSignedEmail"),
  email.indexOf("export async function sendAgreementSignedOpsEmail"),
);
ok(
  /mode: "payment"/.test(src) && /paymentIds: ids.join/.test(src),
  "Checkout is a payment for the rows written first",
);
ok(!/stripe_payment_intent_id/.test(src), "the two rows do not share a payment intent id");
ok(
  /initial_payment_link/.test(src) && /tiedToRenter: false/.test(src),
  "a settings link is the fallback and is marked shared",
);
ok(
  /Pay \$\{escapeHtml\(money\)\}/.test(signed) && /not tied to your rental/.test(signed),
  "the signed email carries the pay button and says when the link is shared",
);
ok(
  !/payment/i.test(
    email.slice(
      email.indexOf("export async function sendAgreementEmail"),
      email.indexOf("export async function sendAgreementSignedEmail"),
    ),
  ),
  "the signing email still has no payment link",
);

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log("\ninitial payment ok");
