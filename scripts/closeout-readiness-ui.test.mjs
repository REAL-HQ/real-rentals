import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
const result = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CloseoutReadiness} from './src/components/admin/CloseoutReadiness';createRoot(document.getElementById('root')).render(<CloseoutReadiness rentalId="synthetic"/>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { "@": resolve("src") },
  plugins: [
    {
      name: "synthetic-server",
      setup(b) {
        b.onResolve(
          { filter: /^@tanstack\/react-start$|^@\/lib\/closeout-readiness.functions$/ },
          (a) => ({ path: a.path, namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          contents: a.path.includes("react-start")
            ? "const load=()=>window.__evidence();export const useServerFn=()=>load;"
            : "export const getRentalCloseoutReadiness={};",
          loader: "js",
        }));
      },
    },
  ],
  logLevel: "silent",
});
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/html");
  res.end(
    req.url === "/app.js"
      ? result.outputFiles[0].text
      : '<html><body><div id="root"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
let passed = 0;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  });
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin) ? route.continue() : route.abort(),
    );
    await page.addInitScript(() => {
      window.__evidence = () =>
        new Promise((resolve) => {
          window.releaseEvidence = resolve;
        });
    });
    await page.goto(origin);
    await page.getByText("Unknown — Loading closeout evidence…").waitFor();
    passed++;
    await page.evaluate(() =>
      window.releaseEvidence({
        checks: [
          {
            key: "inspection",
            title: "Return Inspection",
            state: "Needs Attention",
            explanation: "Failed — review return inspection.",
            completedAt: "2026-10-14T10:00:00Z",
            criticalFailures: ["Brakes"],
          },
          {
            key: "billing",
            title: "Billing",
            state: "Unknown",
            explanation: "Provider cancellation is unverified.",
          },
          {
            key: "charges",
            title: "Outstanding Charges",
            state: "Ready",
            explanation: "No unpaid recorded balance.",
          },
        ],
      }),
    );
    await page.getByText("Critical failures: Brakes").waitFor();
    passed++;
    await page.getByText("Provider cancellation is unverified.").waitFor();
    passed++;
    assert.equal(await page.locator("button,input").count(), 0);
    passed++;
    await page.addInitScript(() => {
      window.__evidence = () => Promise.reject(new Error("private credentials"));
    });
    await page.reload();
    await page.getByText("Unknown — Could not load closeout evidence.").waitFor();
    assert(
      !(await page
        .locator("body")
        .innerText()
        .then((x) => x.includes("private credentials"))),
    );
    passed++;
    await page.close();
  }
  console.log(`${passed} synthetic browser component checks passed (390/1440px)`);
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
