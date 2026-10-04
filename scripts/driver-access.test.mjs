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

/* ---------------------------------- identity linking is never silent ----- */
console.log("\nan application is never handed to a different identity");

// Found in review: provisioning resolved an identity from the application's
// email and wrote applications.user_id unconditionally. Change the email and
// re-approve, and the original driver lost their documents, agreement and
// payments to whatever account the new address resolved to — and if that
// address had no account, one was created and sent a set-password email for
// an application that person never filed.
ok(
  /\.select\("user_id"\)[\s\S]{0,120}\.eq\("id", args\.applicationId\)/.test(account),
  "the current owner is read before anything is created",
);
ok(
  account.indexOf('.select("user_id")') < account.indexOf("ensureAuthUser(admin"),
  "and read BEFORE the auth user is found or created, so a conflict creates nothing",
);
ok(
  /if \(ownerEmail && ownerEmail !== target\)[\s\S]{0,260}return \{[\s\S]{0,120}conflict: true/.test(account),
  "a mismatch returns a conflict instead of relinking",
);
ok(
  /conflict: true[\s\S]{0,80}inviteUrl: null/.test(account),
  "and mints no set-password link for the new address",
);
ok(
  /portalAccount = account\.conflict/.test(apps),
  "approval reports the conflict rather than claiming a login was made",
);
ok(
  /"conflict"/.test(read("src/components/admin/DriversPanel.tsx")),
  "and staff are told, in the approval toast",
);
ok(
  /code: "account_conflict"/.test(rentals) && !/overrideBlockers[\s\S]{0,200}account_conflict/.test(rentals),
  "activation returns account_conflict directly, outside the overridable path",
);
ok(
  /if \(portalAccount === "conflict"\)[\s\S]{0,420}agreementSent: false/.test(apps),
  "a conflicted identity is never issued a signable agreement",
);

// Anyone can register an account for any address through the public sign-up
// forms. Adopting one on trust hands the applicant's documents, agreement and
// vehicle to whoever got there first.
ok(
  /if \(!created && !ownerId\)[\s\S]{0,700}conflict: true/.test(account),
  "a pre-existing account with no application of its own is not adopted",
);
ok(
  /\.eq\("user_id", userId\)[\s\S]{0,60}\.limit\(1\)/.test(account),
  "adoption requires that account to already own an application",
);

// Reporting success for a login that cannot open the portal sends somebody a
// set-password email for a dead end.
ok(
  /throw new Error\(`Driver role could not be granted/.test(account),
  "a failed role grant fails the call instead of logging and returning success",
);
ok(
  /throw new Error\(`Application could not be linked/.test(account),
  "so does a failed application link",
);

// The driver-editable half of the same hole.
const portalFnsSrc = read("src/lib/portal.functions.ts");
const updateBody = portalFnsSrc.slice(
  portalFnsSrc.indexOf("export const updateDriverProfile"),
  portalFnsSrc.indexOf("export const", portalFnsSrc.indexOf("export const updateDriverProfile") + 10),
);
ok(updateBody.length > 400, "found updateDriverProfile");
ok(
  !/out\.email\s*=/.test(updateBody),
  "a driver cannot change the email their account identity resolves from",
);
ok(
  !/email\?: string;/.test(updateBody),
  "the field is not even accepted, so a crafted request cannot set it",
);

/* ------------------------------- the profile write must actually write --- */
console.log("\nSettings saves what it says it saved");

// public.applications has exactly one UPDATE policy and it is is_staff(), so
// this statement through the caller's own session matched zero rows, returned
// no error, and the UI reported success.
ok(
  /supabaseAdmin[\s\S]{0,200}\.from\("applications"\)[\s\S]{0,120}\.update\(patch as any\)/.test(updateBody),
  "the update runs with the service role, after ownership is proved through RLS",
);
ok(
  /\.eq\("id", app\.id\)[\s\S]{0,40}\.select\("id"\)/.test(updateBody),
  "scoped to the one application, and the write is read back",
);
ok(
  /if \(!updated \|\| updated\.length === 0\) return \{ error:/.test(updateBody),
  "a write that changed nothing is reported as a failure, not as success",
);
const migrationSql = (function walkSqlFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) out.push(...walkSqlFiles(f));
    else if (/\.sql$/.test(name)) out.push(f);
  }
  return out;
})("supabase");
const appUpdatePolicies = migrationSql
  .map(read)
  .filter((sql) => /CREATE POLICY[^;]{0,200}ON public\.applications[\s\S]{0,200}FOR UPDATE/i.test(sql));
ok(
  appUpdatePolicies.every((sql) => !/FOR UPDATE[\s\S]{0,160}user_id = auth\.uid\(\)/i.test(sql)),
  "no self-update policy was added to applications — the allow-list stays in code",
);

/* ------------------------------------- the panel claims only what it knows */
console.log("\nthe pre-rental panel does not invent a status");

ok(
  /applicationStatus/.test(portalFnsSrc),
  "the dashboard returns the application status",
);
ok(
  /const approved = status === "approved" \|\| status === "active"/.test(portal),
  "the panel decides from that status, not from the absence of a rental",
);
ok(
  /\{approved \? "You're Approved" : "Your Application"\}/.test(portal),
  "a rejected or finished applicant is not told they are approved",
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
