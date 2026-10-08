# Application Resume — Dependency Advisory Breakdown

**Proposals only: no dependency or lockfile was changed.** Fresh Bun audit and GitHub Advisory API checked on 2026-10-08. The lockfile and package manifest are byte-identical to historical baseline `5bc960c0` and candidate `ecd470d7`. This proves the findings exist in that source baseline, not that every affected package is deployed or exploitable in current production.

The audit reports 33 package/range entries: 1 critical, 22 high, 8 moderate, 2 low across 11 package names. Critical/high findings comprise 18 unique GHSA advisories across 8 package names (23 range entries, since some advisories affect both installed brace-expansion major lines).

## Proposed smallest version changes

These versions were confirmed available from the npm registry. Approval is requested for a targeted lockfile update preserving each dependency's major line, with an exact diff review, fresh audit, build and tests. This is not a claim that those versions have already been installed or tested, or that every future advisory will be cleared. No broad dependency update is proposed.

| Package | Installed | Proposed target | Classification / dependency path | Compatibility considerations |
|---|---|---|---|---|
| shell-quote | 1.9.0 | 1.11.0 | Development only: Lovable config → devtools-vite → launch-editor. The observed consumer calls parse(), not the vulnerable quote() path. | Same-major minor; quote() rejects additional dangerous inputs; verify editor tooling. |
| brace-expansion | 1.1.14 / 5.0.5 | 1.1.21 / 5.0.12 | Development only: ESLint/minimatch and typescript-eslint/minimatch. | Keep both major lines; do not force v5 on minimatch v3. Test lint/glob behavior and Node engine. |
| browserslist | 4.28.2 | 4.28.7 | Build tooling through TanStack/Babel and Vite React. Reachable from a production-declared root as well as dev roots. | Patch update; target/browser databases and emitted CSS/JS may change. |
| js-yaml | 4.1.1 | 4.3.2 | ESLint and TanStack build plugin → xmlbuilder2. Production-declared root does not establish runtime reachability. | Same-major minor; changed resource limits/merge behavior require config parsing tests. |
| nanoid | 3.3.11 | 3.3.18 | Development graph through Vite → PostCSS. | Patch on CommonJS-compatible v3; validate generators and PostCSS build. |
| postcss | 8.5.10 | 8.5.23 | Development graph through Vite. | Patch; includes fixes beyond high advisories for the reported moderate source-map issue. Compare generated CSS. |
| source-map-js | 1.2.1 | 1.2.2 | Build tooling via Tailwind and Vite/PostCSS; both production/dev declarations. | Patch; invalid source maps may now be rejected. |
| vite | 7.3.2 | 7.3.5 | Direct devDependency; advisory concerns Windows development server file-deny behavior. | Patch on v7, not Vite 8; verify Lovable/TanStack/Nitro integration and Node >=20.19 or >=22.12. |

## Deployed-code reachability

A temporary build-inventory plugin, outside the repository, recorded rendered module IDs for client (1,039), SSR (331), and Nitro worker (1,324) outputs. None of these eight affected package names contributes rendered modules in any of those outputs. The generated output package declares no external dependencies. No direct imports of these packages were found in application source. Therefore the examined advisory paths are build/development exposure in this release artifact, not demonstrated request-time vulnerabilities. Build systems still process code/config and must not be treated as safe merely because a package is absent from the deployed worker.

The particularly severe shell-quote advisory requires quote() on a comment token followed by a line-terminating string and execution of the resulting shell command. The installed launch-editor consumer uses parse(specifiedEditor); no quote() call or deployed-module inclusion was found. This reduces demonstrated reachability; it does not waive the dependency finding. Vite's high finding requires a Windows dev server, unlike the generated Cloudflare worker. Browserlist/YAML/glob/source-map findings depend on attacker-controlled build inputs; Nanoid findings require bad generator sizes. No application request path to these vulnerable APIs was identified.

## Every critical/high audit entry

Patched values below come from the GitHub advisory for the matching installed version range. Proposed targets above sometimes go further within the same major to cover other reported advisories.

| Package | Installed affected version | Severity | Advisory | Affected range | First patch for installed line |
|---|---|---|---|---|---|
| brace-expansion | 1.1.14 | high | [GHSA-mh99-v99m-4gvg: brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | `<1.1.17` | 1.1.17 |
| brace-expansion | 5.0.5 | high | [GHSA-mh99-v99m-4gvg: brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | `>=4.0.0 <5.0.8` | 5.0.8 |
| brace-expansion | 5.0.5 | high | [GHSA-rgw5-rvv9-x895: brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | `>=4.0.0 <5.0.9` | 5.0.9 |
| brace-expansion | 1.1.14 | high | [GHSA-rgw5-rvv9-x895: brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | `<1.1.18` | 1.1.18 |
| brace-expansion | 1.1.14 | high | [GHSA-3jxr-9vmj-r5cp: brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | `<1.1.16` | 1.1.16 |
| brace-expansion | 5.0.5 | high | [GHSA-3jxr-9vmj-r5cp: brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | `>=3.0.0 <5.0.7` | 5.0.7 |
| brace-expansion | 5.0.5 | high | [GHSA-qhr7-859c-m2p7: brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | `>=4.0.0 <5.0.11` | 5.0.11 |
| brace-expansion | 1.1.14 | high | [GHSA-6j4f-fj2g-mc7p: brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | `<1.1.19` | 1.1.19 |
| brace-expansion | 5.0.5 | high | [GHSA-6j4f-fj2g-mc7p: brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | `>=4.0.0 <5.0.10` | 5.0.10 |
| brace-expansion | 1.1.14 | high | [GHSA-qhr7-859c-m2p7: brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | `<1.1.20` | 1.1.20 |
| browserslist | 4.28.2 | high | [GHSA-c83g-rgw3-j3cx: Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) | `<=4.28.6` | 4.28.7 |
| browserslist | 4.28.2 | high | [GHSA-73wf-gq98-2v4g: Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats)](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | `<=4.28.6` | 4.28.7 |
| js-yaml | 4.1.1 | high | [GHSA-52cp-r559-cp3m: js-yaml: YAML merge-key chains can force quadratic CPU consumption](https://github.com/advisories/GHSA-52cp-r559-cp3m) | `>=4.0.0 <4.3.0` | 4.3.0 |
| js-yaml | 4.1.1 | high | [GHSA-5p4m-2wfm-xmqj: JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) | `>=4.0.0 <4.3.1` | 4.3.1 |
| js-yaml | 4.1.1 | high | [GHSA-2883-xcg3-v3hh: js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources](https://github.com/advisories/GHSA-2883-xcg3-v3hh) | `>=4.0.0 <4.3.2` | 4.3.2 |
| nanoid | 3.3.11 | high | [GHSA-28wg-ghj8-5hjv: nanoid: non-secure generators can loop indefinitely with negative size](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) | `<3.3.16` | 3.3.16 |
| nanoid | 3.3.11 | high | [GHSA-2v37-7h3g-55p8: nanoid: custom generators can loop indefinitely when size is zero](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | `<3.3.18` | 3.3.18 |
| nanoid | 3.3.11 | high | [GHSA-xwg4-73v4-xw9w: nanoid: Integer Overflow or Wraparound](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) | `<3.3.12` | 3.3.12 |
| postcss | 8.5.10 | high | [GHSA-6g55-p6wh-862q: PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments](https://github.com/advisories/GHSA-6g55-p6wh-862q) | `<=8.5.11` | 8.5.12 |
| postcss | 8.5.10 | high | [GHSA-r28c-9q8g-f849: PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure](https://github.com/advisories/GHSA-r28c-9q8g-f849) | `<=8.5.17` | 8.5.18 |
| shell-quote | 1.9.0 | critical | [GHSA-pqg4-j6r4-53mv: shell-quote: `quote()` command injection via a line terminator in a token after a `{ comment }` token](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) | `>=1.8.4 <1.11.0` | 1.11.0 |
| source-map-js | 1.2.1 | high | [GHSA-68fv-2mgg-jv7q: source-map-js allows event-loop denial of service through indexed source-map section offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | `>=1.0.0 <1.2.2` | 1.2.2 |
| vite | 7.3.2 | high | [GHSA-fx2h-pf6j-xcff: vite: `server.fs.deny` bypass on Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | `>=7.0.0 <=7.3.4` | 7.3.5 |

## Other audit findings

Low/moderate findings additionally affect @babel/core, baseline-browser-mapping and esbuild. They remain open. Babel/browser-mapping are compiler tooling. Nested esbuild versions include 0.18.20 (Drizzle tooling, affected by the development-server CORS advisory), 0.27.7 (Windows dev-server advisory), and unaffected 0.25.12 for these reported ranges. Do not force one esbuild minor line on all consumers; an approved follow-up should choose parent-compatible fixes and re-audit. No migration tool was invoked.
