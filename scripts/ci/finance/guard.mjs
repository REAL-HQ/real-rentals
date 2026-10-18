import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const manifest = JSON.parse(readFileSync(new URL('./source-manifest.json', import.meta.url)));
const coverage = JSON.parse(readFileSync(new URL('./test-coverage.json', import.meta.url)));
export function verifyScope(paths) {
  const allowed = new Set([...Object.keys(manifest.files), ...manifest.ciFiles]);
  assert(paths.every(p => allowed.has(p)), 'Unapproved application/infrastructure path');
  assert(Object.keys(manifest.files).every(p => paths.includes(p)), 'Missing approved source path');
}
export function verifyResults(report, root) {
  assert.equal(report.success, true);
  for (const k of ['numFailedTests','numPendingTests','numTodoTests','numFailedTestSuites','numPendingTestSuites']) assert.equal(report[k], 0, k);
  assert.equal(report.numTotalTests, 257); assert.equal(report.numPassedTests, 257);
  assert.equal(report.testResults.length, Object.keys(coverage).length);
  const actual = {};
  for (const suite of report.testResults) {
    const path = Object.keys(coverage).find(p => resolve(root,p) === resolve(suite.name));
    assert(path && !actual[path], 'Unexpected/duplicate/missing test suite');
    assert.equal(suite.status, 'passed');
    assert(!suite.message, 'Suite tooling error');
    for (const a of suite.assertionResults) {
      assert.equal(a.status, 'passed', 'Skipped/failed assertion');
      assert.deepEqual(a.failureMessages, []);
    }
    actual[path] = suite.assertionResults.map(a => a.fullName).sort();
  }
  assert.deepEqual(actual, coverage, 'Exact assertion coverage differs');
}
export function verifySource(root) {
  const git = (...a) => execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
  git('merge-base','--is-ancestor',manifest.foundation,'HEAD');
  git('merge-base','--is-ancestor',manifest.candidate,'HEAD');
  verifyScope(git('diff','--name-only',manifest.foundation,'HEAD').split('\n'));
  for (const [p,h] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex'),h,'Unreviewed source: '+p);
  }
  // Pinning every changed byte plus excluding every other path protects the reviewed
  // disabled endpoint, synthetic-only adapters, dependencies, schemas and live screens.
  git('diff','--exit-code','HEAD','--',...Object.keys(manifest.files));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv[2] === 'source') verifySource(process.cwd());
  else if(process.argv[2] === 'results') verifyResults(JSON.parse(readFileSync(process.argv[3])),process.cwd());
  else throw Error('Expected source or results mode');
  console.log('Finance guard PASS: '+process.argv[2]);
}
