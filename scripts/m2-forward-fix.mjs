// Builds an M2 Window 2 forward-fix request from a fix body. Never contacts a database.
//   node scripts/m2-forward-fix.mjs <fix-body.sql> <out-dir> [--allow-boundary 'private.f(uuid)',...]
// The body is linted: only CREATE OR REPLACE FUNCTION, ALTER FUNCTION ... SET/RESET, COMMENT ON
// FUNCTION and GRANT/REVOKE EXECUTE ON FUNCTION may appear at top level (no data statement, no
// DROP, no table or policy DDL, no BEGIN/COMMIT, no DO), and nothing may mention a Security 0031
// policy. The package is then:
//   header line | fingerprint taken into a temp table | refusal codes of each named boundary
//   function | the body | a check that refuses (rolling back the whole request) unless the
//   fingerprint is identical and every named boundary function still raises every code it raised
// and the request is guard v3 (scripts/sql-guard/gen-guard3.py) followed by those exact bytes.
// Boundary functions (approval_*, identity RPCs, anything raising positive_identity_required) are
// in the fingerprint, so replacing one is refused unless the owner names it with --allow-boundary.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const FP_FILE = "proposed/m2-window2/evidence-fingerprint-readonly.sql";
const ALLOWED = [
  /^CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(public|private)\.[a-z_0-9]+\s*\(/i,
  /^ALTER\s+FUNCTION\s+(public|private)\.[a-z_0-9]+\s*\([^)]*\)\s+(SET|RESET)\s/i,
  /^COMMENT\s+ON\s+FUNCTION\s+(public|private)\.[a-z_0-9]+\s*\(/i,
  /^(GRANT|REVOKE)\s+EXECUTE\s+ON\s+FUNCTION\s+(public|private)\.[a-z_0-9]+\s*\(/i,
];

/** Top-level statements with comments, dollar-quoted bodies and string literals blanked. */
export function topLevelStatements(sql) {
  let s = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/(\$[A-Za-z_0-9]*\$)[\s\S]*?\1/g, " $BODY$ ");
  s = s.replace(/'(?:[^']|'')*'/g, "''");
  return s.split(";").map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean);
}

export function lintFix(sql) {
  const problems = [];
  if (/coordinator_[a-z_]*_containment/i.test(sql)) problems.push("mentions a Security 0031 policy");
  if (/\r/.test(sql)) problems.push("contains a carriage return");
  const stmts = topLevelStatements(sql);
  if (stmts.length === 0) problems.push("no statements");
  for (const st of stmts) if (!ALLOWED.some((re) => re.test(st))) problems.push(`statement not allowed: ${st.slice(0, 80)}`);
  return problems;
}

function fingerprintExpr(exclude) {
  const text = readFileSync(FP_FILE, "utf8");
  const body = text.slice(text.indexOf("-- RRFP-BEGIN\n") + 14, text.indexOf("-- RRFP-END"));
  const list = exclude.length ? `ARRAY[${exclude.map((x) => `'${x.replace(/'/g, "''")}'`).join(",")}]::text[]` : "ARRAY[]::text[]";
  const expr = body.split("/*RRFP-EXCLUDE*/ARRAY[]::text[]").join(list);
  if (expr === body && exclude.length) throw new Error("fingerprint exclusion marker missing");
  return expr.trim();
}

export function buildPackage(name, fixSql, exclude = []) {
  const problems = lintFix(fixSql);
  if (problems.length) throw new Error(`fix refused by lint:\n- ${problems.join("\n- ")}`);
  for (const sig of exclude) if (!/^(public|private)\.[a-z_0-9]+\([a-z_0-9 ,.\[\]"]*\)$/i.test(sig)) throw new Error(`bad signature ${sig}`);
  const fp = fingerprintExpr(exclude);
  const sigs = `ARRAY[${exclude.map((x) => `'${x}'`).join(",")}]::text[]`;
  return [
    `-- RR M2 forward fix ${name}: function-level change, evidence fingerprint enforced in-request.`,
    `CREATE TEMP TABLE rr_fix_fp ON COMMIT DROP AS ${fp};`,
    `CREATE TEMP TABLE rr_fix_codes ON COMMIT DROP AS SELECT p.oid AS fn, (SELECT pn.nspname FROM pg_catalog.pg_namespace pn WHERE pn.oid = p.pronamespace) || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS sig, ARRAY(SELECT DISTINCT m[1] FROM regexp_matches(pg_get_functiondef(p.oid), $q$RAISE EXCEPTION '([A-Za-z_0-9]+)$q$, 'g') m ORDER BY 1) AS codes FROM pg_catalog.pg_proc p WHERE p.prokind = 'f' AND ((SELECT pn.nspname FROM pg_catalog.pg_namespace pn WHERE pn.oid = p.pronamespace) || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')') = ANY (${sigs});`,
    `DO $rrfixpre$ BEGIN IF (SELECT count(*) FROM rr_fix_codes) <> ${exclude.length} THEN RAISE EXCEPTION 'RRFIX_NAMED_FUNCTION_MISSING'; END IF; END $rrfixpre$;`,
    fixSql.trimEnd(),
    `DO $rrfixpost$`,
    `BEGIN`,
    `  IF (SELECT evidence_fingerprint FROM rr_fix_fp) IS DISTINCT FROM (SELECT evidence_fingerprint FROM (${fp}) q) THEN`,
    `    RAISE EXCEPTION 'RRFIX_EVIDENCE_CHANGED';`,
    `  END IF;`,
    `  IF EXISTS (SELECT 1 FROM rr_fix_codes c WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = c.fn)`,
    `      OR NOT (c.codes <@ ARRAY(SELECT DISTINCT m[1] FROM regexp_matches(pg_get_functiondef(c.fn), $q$RAISE EXCEPTION '([A-Za-z_0-9]+)$q$, 'g') m))) THEN`,
    `    RAISE EXCEPTION 'RRFIX_REFUSAL_REMOVED';`,
    `  END IF;`,
    `END`,
    `$rrfixpost$;`,
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fixPath, outDir, flag, list] = process.argv.slice(2);
  if (!fixPath || !outDir) { console.error("usage: m2-forward-fix.mjs <fix.sql> <out-dir> [--allow-boundary sig,...]"); process.exit(2); }
  const exclude = flag === "--allow-boundary" ? list.split(/,(?![^(]*\))/).map((x) => x.trim()) : [];
  const name = basename(fixPath, ".sql");
  let pkg;
  try { pkg = buildPackage(name, readFileSync(fixPath, "utf8"), exclude); } catch (e) { console.error(String(e.message)); process.exit(1); }
  mkdirSync(outDir, { recursive: true });
  const pkgPath = join(outDir, `${name}.package.sql`);
  writeFileSync(pkgPath, pkg);
  const guard = execFileSync("python3", ["-I", "scripts/sql-guard/gen-guard3.py", pkgPath]);
  const request = Buffer.concat([guard, Buffer.from(pkg)]);
  writeFileSync(join(outDir, `${name}.request.sql`), request);
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  writeFileSync(join(outDir, `${name}.SHA256SUMS`), `${sha(Buffer.from(pkg))}  ${name}.package.sql\n${sha(request)}  ${name}.request.sql\n`);
  console.log(`forward fix ${name}: package ${sha(Buffer.from(pkg))}, request ${sha(request)}${exclude.length ? `, named boundary functions: ${exclude.join(" ")}` : ""}`);
}
