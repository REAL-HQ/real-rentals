/**
 * An approved applicant must be able to sign in and finish their own paperwork.
 *
 * The account used to be created inside activateRental — the moment a vehicle
 * was assigned. That left the window between "approved" and "here are your
 * keys" with no login behind it, which is exactly the window where documents
 * and a signed agreement decide whether the rental happens at all.
 *
 * These assertions hold the new line: provisioning happens at approval, both
 * callers share one idempotent path, nothing driver-facing is gated on a
 * rental, and there is a way back in when a password is lost.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let fail = 0;
const ok = (cond, label) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
};
const read = (p) => readFileSync(p, "utf8");
/**
 * Prose that names a banned string in order to ban it is not an occurrence of
 * it. These checks are about what renders, so comments come out first.
 */
const code = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACCOUNT = "src/lib/driver-account.server.ts";
const APPS = "src/lib/applications.functions.ts";
const RENTALS = "src/lib/rentals.functions.ts";
const PORTAL = "src/routes/portal.tsx";
const LOGIN = "src/routes/login.tsx";
const SETPW = "src/routes/set-password.tsx";
const ADMIN = "src/routes/admin.tsx";
const EMAIL = "src/lib/email.server.ts";

const account = read(ACCOUNT);
const apps = read(APPS);
const rentals = read(RENTALS);
const portal = read(PORTAL);
const login = read(LOGIN);
const setpw = read(SETPW);
const admin = read(ADMIN);
const email = read(EMAIL);

/* ------------------------------------------------- one provisioning path -- */
console.log("\none way to get a login");

ok(existsSync(ACCOUNT), "the shared provisioning module exists");
ok(
  /export async function provisionDriverAccount/.test(account),
  "it exports provisionDriverAccount",
);
ok(
  /\.from\("user_roles"\)[\s\S]{0,80}role: "driver"/.test(account),
  "it grants the driver role",
);
ok(
  /\.from\("applications"\)[\s\S]{0,80}update\(\{ user_id: userId \}\)/.test(account),
  "it links the application to the account — every driver read resolves through this",
);
ok(
  /duplicate key/.test(account),
  "a repeated role grant is tolerated, so the function is safe to call twice",
);
// Match the import, not the identifier: a local stub of the same name would
// satisfy a name check while quietly provisioning nobody.
const IMPORTS_PROVISIONER =
  /const \{ provisionDriverAccount \} = await import\("@\/lib\/driver-account\.server"\)/;
ok(IMPORTS_PROVISIONER.test(apps), "approval imports and calls the real provisioner");
ok(
  IMPORTS_PROVISIONER.test(rentals),
  "activation does too, as the repair path for older approvals",
);
// There must be exactly one implementation.
ok(
  !/async function ensureDriverAccount/.test(rentals),
  "activation no longer carries its own copy of the logic",
);
ok(
  !/auth\.admin\.createUser/.test(rentals) && !/auth\.admin\.createUser/.test(apps),
  "neither caller creates auth users directly",
);

/* ------------------------------------------- approval must not be undone -- */
console.log("\nprovisioning never breaks an approval that already happened");

const approveBody = apps.slice(
  apps.indexOf("export const approveApplication"),
  apps.indexOf("export const", apps.indexOf("export const approveApplication") + 10),
);
ok(approveBody.length > 500, "found the approveApplication handler");
ok(
  /try \{[\s\S]{0,400}provisionDriverAccount[\s\S]{0,400}\} catch/.test(approveBody),
  "provisioning is wrapped — a failure is caught, not thrown",
);
ok(
  /portalAccount = "failed"/.test(approveBody),
  "a failure is reported back to the operator instead",
);
ok(
  approveBody.indexOf("logAudit") < approveBody.indexOf("provisionDriverAccount"),
  "the approval is recorded and audited before provisioning is attempted",
);
ok(
  /portalAccount === "created"/.test(approveBody),
  "only a brand-new account triggers the set-password email",
);
ok(
  /export async function sendPortalInviteEmail/.test(email),
  "the invite email exists",
);
ok(
  /portalAccount/.test(read("src/components/admin/DriversPanel.tsx")),
  "the admin UI tells staff what happened to the login",
);

/* --------------------------------------- nothing driver-facing needs a car */
console.log("\nan approved applicant can use the portal before a vehicle exists");

const portalFns = read("src/lib/portal.functions.ts");
const docFns = read("src/lib/documents.functions.ts");
for (const [label, src, fn] of [
  ["getMyVault", docFns, "getMyVault"],
  ["updateDriverProfile", portalFns, "updateDriverProfile"],
  ["getDriverProfile", portalFns, "getDriverProfile"],
  ["getDriverDocuments", portalFns, "getDriverDocuments"],
]) {
  const start = src.indexOf(`export const ${fn}`);
  const body = src.slice(start, src.indexOf("export const", start + 10));
  ok(start !== -1 && !/from\("rentals"\)/.test(body), `${label} does not require a rental`);
}
// The RLS policy that backs all of it scopes by application ownership only.
const policy = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => read(join("supabase/migrations", f)))
  .find((sql) => sql.includes('"Drivers view their own documents"'));
ok(!!policy, "found the drivers-own-documents policy");
ok(
  /a\.user_id = auth\.uid\(\)/.test(policy ?? "") && !/rentals/.test(policy ?? ""),
  "the policy keys on applications.user_id, never on an active rental",
);

/* -------------------------------------------------------- the portal nav -- */
console.log("\nthe portal shows only what is true yet");

ok(
  /const RENTAL_TABS = new Set<Tab>\(\["vehicle", "deposit", "maintenance", "pictures"\]\)/.test(portal),
  "the rental-only tabs are named explicitly",
);
ok(
  /hasRental \|\| !RENTAL_TABS\.has\(t\.id\)/.test(portal),
  "they are filtered out until a rental exists",
);
ok(
  /\{visibleTabs\.map/.test(portal) && !/\{TABS\.map/.test(portal),
  "both the sidebar and the mobile pills use the filtered list",
);
ok(
  /if \(!visibleTabs\.some\(\(t\) => t\.id === tab\)\) setTab\("dashboard"\)/.test(portal),
  "a tab that disappears cannot strand the viewer on it",
);
ok(
  /function PreRentalPanel/.test(portal),
  "the pre-rental dashboard points at the work instead of reporting an absence",
);
ok(
  !/No Active Rental/.test(code(portal)),
  "the old dead-end copy is gone",
);
// Nothing may be claimed about queue position or timing — we do not know it.
ok(
  !/position|queue|estimated|in line|days away/i.test(
    portal.slice(portal.indexOf("function PreRentalPanel"), portal.indexOf("function DashboardView")),
  ),
  "the pre-rental panel promises no timeline it cannot know",
);

/* ------------------------------------------------------- the way back in -- */
console.log("\nlosing a password is recoverable");

ok(existsSync(LOGIN) && existsSync(SETPW), "a driver sign-in page and a set-password page exist");
ok(
  /resetPasswordForEmail/.test(login),
  "the driver page can send a reset link",
);
ok(
  /resetPasswordForEmail/.test(admin),
  "so can the staff page — it had no recovery either",
);
ok(
  /redirectTo: `\$\{window\.location\.origin\}\/set-password`/.test(login) &&
    /redirectTo: `\$\{window\.location\.origin\}\/set-password`/.test(admin),
  "both land on the same set-password page",
);
ok(
  /auth\.updateUser\(\{ password: pw \}\)/.test(setpw),
  "that page actually sets the password",
);
// An account-existence oracle is a way to enumerate who rents from us.
ok(
  /If an account exists for/.test(login) && !/\bif \(error\) return setErr\(error\.message\)[\s\S]{0,80}resetPassword/.test(login),
  "the reset box answers the same way whether or not the address is known",
);
ok(
  /If that address has an account/.test(admin),
  "the staff reset says the same",
);
ok(
  /to="\/login"/.test(portal) && !/to="\/admin"[\s\S]{0,120}Sign In/.test(portal),
  "the portal sends drivers to their own sign-in, not the back office",
);
ok(
  !/Create Account/.test(code(login)) && !/auth\.signUp/.test(code(login)),
  "there is no self-signup — an account comes from being approved",
);

console.log(`\n${fail === 0 ? "PASS" : `FAIL — ${fail} assertion(s)`}`);
process.exit(fail === 0 ? 0 : 1);
