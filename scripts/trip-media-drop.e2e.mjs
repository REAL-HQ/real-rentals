/**
 * Real-browser drag-and-drop and picker test for trip media uploads.
 *
 * Bundles the real FileUploader/FileDropBridge with esbuild, opens it in
 * headless Chrome, and dispatches genuine DragEvents carrying a DataTransfer
 * of mixed photos/videos (plus bad ones), then uses the file picker.
 * Synthetic files only; no network or database.
 *
 * Run: CHROME=/usr/bin/google-chrome PLAYWRIGHT_CORE=/path/to/playwright-core node scripts/trip-media-drop.e2e.mjs
 * Skips (exit 0, says so) when no Chrome/playwright-core is available.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const PW = process.env.PLAYWRIGHT_CORE;
if (!PW || !existsSync(CHROME)) {
  console.log("SKIP trip-media drop e2e: set PLAYWRIGHT_CORE and CHROME");
  process.exit(0);
}
const { chromium } = await import(PW);
const root = resolve(new URL("..", import.meta.url).pathname);
const out = mkdtempSync(join(tmpdir(), "trip-drop-"));
await build({
  entryPoints: [join(root, "scripts/fixtures/trip-media-drop-harness.tsx")],
  bundle: true,
  outfile: join(out, "h.js"),
  format: "iife",
  jsx: "automatic",
  alias: { "@": join(root, "src") },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  logLevel: "silent",
});
const js = readFileSync(join(out, "h.js"), "utf8");
writeFileSync(join(out, "i.html"), `<!doctype html><body><div id="root"></div><script>${js}</script></body>`);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("file://" + join(out, "i.html"));
await page.waitForSelector('[data-phase="checkout"] [role="button"]');
const startUrl = page.url();

async function drop(selector, files) {
  await page.evaluate(
    ({ selector, files }) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type, lastModified: 1700000000000 }));
      const el = selector ? document.querySelector(selector) : document.body;
      for (const t of ["dragenter", "dragover", "drop"]) {
        el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    },
    { selector, files },
  );
}
const jpg = [0xff, 0xd8, 0xff, 0xe1, 1, 2, 3];
const mov = [0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70];
const big = { name: "huge.mp4", type: "video/mp4", bytes: [] };
let pass = 0;
const ok = (m) => (pass++, console.log("PASS", m));

// 1. Mixed batch dropped on Pickup: photos + video + HEIC with blank type + junk.
await drop('[data-phase="checkout"] [role="button"]', [
  { name: "front.jpg", type: "image/jpeg", bytes: jpg },
  { name: "walk.mov", type: "video/quicktime", bytes: mov },
  { name: "IMG_7.HEIC", type: "", bytes: [1, 2, 3, 4] },
  { name: "notes.txt", type: "text/plain", bytes: [65] },
  { name: "fail-rear.jpg", type: "image/jpeg", bytes: jpg },
]);
await page.waitForFunction(() => window.calls.length >= 4);
await page.waitForTimeout(300);
let calls = await page.evaluate(() => window.calls);
assert.deepEqual(calls.map((c) => c.name), ["front.jpg", "walk.mov", "IMG_7.HEIC", "fail-rear.jpg"]);
assert.ok(calls.every((c) => c.phase === "checkout"));
assert.deepEqual(calls[0].head, [0xff, 0xd8, 0xff, 0xe1]);
ok("drop delivers every valid photo/video, in order, to the zone's phase, bytes untouched");
assert.equal(page.url(), startUrl);
ok("drop does not navigate the browser");
const body = await page.locator('[data-phase="checkout"]').innerText();
assert.match(body, /Network dropped/);
assert.match(body, /Retry/);
assert.match(await page.locator("body").innerText(), /notes\.txt: this file type isn't accepted here/);
ok("invalid file is reported, valid ones kept; failure shown with Retry");
await page.waitForTimeout(800);
assert.equal((await page.evaluate(() => window.calls)).filter((c) => c.name === "fail-rear.jpg").length, 1);
ok("no automatic retry");

// 2. Duplicate of an uploaded file is skipped with a message.
await drop('[data-phase="checkout"] [role="button"]', [{ name: "front.jpg", type: "image/jpeg", bytes: jpg }]);
await page.waitForTimeout(300);
assert.equal((await page.evaluate(() => window.calls)).filter((c) => c.name === "front.jpg").length, 1);
assert.match(await page.locator("body").innerText(), /duplicates skipped/);
ok("duplicate drop skipped and said so");

// 3. Explicit Retry sends that one file once more.
await page.click('[data-phase="checkout"] button:has-text("Retry")');
await page.waitForTimeout(300);
assert.equal((await page.evaluate(() => window.calls)).filter((c) => c.name === "fail-rear.jpg").length, 2);
ok("Retry is explicit and per file");

// 4. Dropping outside any zone does not open the file or upload it.
const before = (await page.evaluate(() => window.calls)).length;
await drop(null, [{ name: "stray.jpg", type: "image/jpeg", bytes: jpg }]);
await page.waitForTimeout(300);
assert.equal(page.url(), startUrl);
ok("stray drop outside a zone never navigates");
void before;

// 5. Picker (mobile alternative) on Return: multiple files, same validation.
await page.setInputFiles('[data-phase="checkin"] input[type="file"][multiple]', [
  { name: "r1.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpg) },
  { name: "r2.mp4", mimeType: "video/mp4", buffer: Buffer.from(mov) },
  { name: "r3.gif", mimeType: "image/gif", buffer: Buffer.from([71, 73, 70]) },
]);
await page.waitForTimeout(400);
calls = await page.evaluate(() => window.calls.filter((c) => c.phase === "checkin"));
assert.deepEqual(calls.map((c) => c.name), ["r1.jpg", "r2.mp4"]);
assert.match(await page.locator("body").innerText(), /r3\.gif: this file type isn't accepted here/);
ok("picker: multiple files, same validation, filed to its own phase only");
void big;

await browser.close();
console.log(`${pass} passed`);
