/**
 * Waitlist email lookups must not treat % or _ in the address as ILIKE wildcards.
 * No database and no mail.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync("src/lib/waitlist.functions.ts", "utf8");
const match = src.match(/export function ilikeExact\(value: string\): string \{([\s\S]*?)\n\}/);
assert.ok(match, "ilikeExact is exported from the waitlist functions");
const ilikeExact = new Function("value", match[1]);

let passed = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  passed += 1;
  console.log("PASS", label);
}

/** Postgres ILIKE with the default backslash escape. */
function ilike(pattern, value) {
  let body = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      body += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      continue;
    }
    if (ch === "%") body += "[\\s\\S]*";
    else if (ch === "_") body += "[\\s\\S]";
    else body += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + body + "$", "i").test(value);
}

check(ilikeExact("plain@example.com") === "plain@example.com", "a normal address is unchanged");
check(ilikeExact("a_b@example.com") === "a\\_b@example.com", "an underscore is escaped");
check(ilikeExact("100%@example.com") === "100\\%@example.com", "a percent sign is escaped");
check(ilikeExact("a\\b@example.com") === "a\\\\b@example.com", "a backslash is escaped");

check(ilike("a_b@example.com", "axb@example.com") === true, "an unescaped underscore matches a different address");
check(ilike(ilikeExact("a_b@example.com"), "axb@example.com") === false, "the escaped underscore does not match a different address");
check(ilike(ilikeExact("a_b@example.com"), "a_b@example.com") === true, "the escaped underscore still matches itself");
check(ilike(ilikeExact("a%b@example.com"), "axxb@example.com") === false, "the escaped percent sign does not match a different address");
check(ilike(ilikeExact("A_B@Example.com"), "a_b@example.com") === true, "the escaped pattern stays case-insensitive");

const lookups = src.match(/\.ilike\("email", [^)]+\)/g) ?? [];
check(
  lookups.length === 2 && lookups.every((line) => line.includes("ilikeExact(")),
  "both waitlist email lookups escape the address",
);
check(!src.includes('.ilike("email", data.email)') && !src.includes('.ilike("email", w.email.trim())'), "the raw address is not passed to ilike");

console.log(`${passed} waitlist ilike checks passed`);
