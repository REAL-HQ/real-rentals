/**
 * /apply?t= must reach /thank-you before the resume hook strips the token.
 *
 * Live smoke on RC2: /apply?t=invalidtoken123 ended on plain /apply and showed
 * the Step 1 contact form. useResumeToken rewrote the URL, the router re-read
 * search with t gone, and allowStashed false then cleared the token before
 * Navigate could leave the page. /thank-you?t= already showed Get A New Secure Link.
 */
import { readFileSync } from "node:fs";
import { resumeTargetFromApply } from "../src/lib/resume-token";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const token = "invalidtoken123";
const handoff = resumeTargetFromApply({ t: token });
ok(handoff?.to === "/thank-you", "a token on /apply goes to /thank-you");
ok(handoff?.search.t === token, "the same token is carried on the thank-you search");
const invalid = resumeTargetFromApply({ t: "x" });
ok(invalid?.to === "/thank-you" && invalid.search.t === "x" && invalid.replace === true, "/apply?t=x lands on /thank-you?t=x before the token can be stripped");
ok(handoff?.replace === true, "the apply URL is replaced, so Back does not return to the credential");
ok(resumeTargetFromApply({}) === null, "/apply with no token stays and starts a new application");
ok(resumeTargetFromApply({ t: "   " }) === null, "a blank token stays and starts a new application");
ok(
  !readFileSync("src/lib/resume-token.ts", "utf8").slice(
    readFileSync("src/lib/resume-token.ts", "utf8").indexOf("export function resumeTargetFromApply"),
    readFileSync("src/lib/resume-token.ts", "utf8").indexOf("export function storeResumeToken"),
  ).includes("sessionStorage"),
  "the handoff does not read a stashed token",
);

const apply = readFileSync("src/routes/apply.tsx", "utf8");
const before = apply.slice(apply.indexOf("beforeLoad:"), apply.indexOf("head:"));
ok(before.includes("resumeTargetFromApply(search)"), "/apply decides the handoff in beforeLoad, before the page strips t");
ok(before.includes("throw redirect(handoff)"), "/apply redirects before the contact form renders");
ok(!before.includes("sessionStorage"), "beforeLoad does not reopen a stashed token");
ok(apply.includes("useResumeToken(t, { allowStashed: false })"), "a stashed token still does not reopen on /apply");
ok(apply.includes("Tell Us How To Reach You"), "/apply with no token still shows the Step 1 contact form");

const hook = readFileSync("src/lib/resume-token.ts", "utf8");
ok(hook.includes('url.searchParams.delete("t")'), "the token is still removed from the address bar");
ok(hook.includes("window.history.replaceState"), "stripping still replaces history rather than pushing a credential URL");

const thanks = readFileSync("src/routes/thank-you.tsx", "utf8");
ok(/const raw = useResumeToken\(t\);/.test(thanks), "/thank-you still stashes and strips through useResumeToken");
ok(!thanks.includes("allowStashed: false"), "/thank-you still reads the token it just stashed");
ok(thanks.includes("thankYouView(token)"), "a refused token and a missing token are chosen before the page renders");
ok(thanks.includes('expired={view === "expired"}'), "a token the server refuses still opens the recovery screen");
const copy = readFileSync("src/lib/secure-link-copy.ts", "utf8");
ok(copy.includes('if (token === "") return "expired"'), "a token the server refuses is the recovery state");
ok(copy.includes("Get A New Secure Link"), "that screen says Get A New Secure Link");
ok(readFileSync("src/components/site/WelcomeBack.tsx", "utf8").includes("secureLinkHeading(kind)"), "the recovery heading still comes from the secure-link copy");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall apply token redirect checks pass");
process.exit(fails ? 1 : 0);
