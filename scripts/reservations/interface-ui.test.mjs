import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {ReservationsPanel} from './src/components/admin/ReservationsPanel';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ReservationsPanel/></QueryClientProvider>);`,
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
      name: "mock-server",
      setup(b) {
        b.onResolve(
          { filter: /^@tanstack\/react-start$|^@\/lib\/reservations.functions$/ },
          (a) => ({ path: a.path, namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          contents: a.path.includes("react-start")
            ? "export const useServerFn=f=>f"
            : `export const listReservations=x=>window.api('list',x.data);export const getReservationOptions=x=>window.api('options',x.data);export const getReservationHistory=x=>window.api('history',x.data);export const changeReservation=x=>window.api('change',x.data);`,
          loader: "js",
        }));
      },
    },
  ],
  logLevel: "silent",
});
let css = "";
try {
  const dir = ".output/public/assets";
  const file = readdirSync(dir).find((f) => f.startsWith("styles-") && f.endsWith(".css"));
  if (file) css = readFileSync(dir + "/" + file, "utf8");
} catch {}
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/app.js" ? "text/javascript" : req.url === "/app.css" ? "text/css" : "text/html",
  );
  res.end(
    req.url === "/app.js"
      ? bundle.outputFiles[0].text
      : req.url === "/app.css"
        ? css
        : '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="padding:16px"><div id="root"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser,
  n = 0;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const width of [390, 1440])
    for (const role of ["owner", "manager", "coordinator"]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }),
        origin = `http://127.0.0.1:${server.address().port}`;
      await page.route("**/*", (r) =>
        r.request().url().startsWith(origin) ? r.continue() : r.abort(),
      );
      await page.addInitScript(
        ({ role }) => {
          window.calls = [];
          window.disabled = false;
          window.fail = false;
          const id = "11111111-1111-4111-8111-111111111111";
          window.record = {
            id,
            application_id: id,
            vehicle_id: id,
            state: "reserved",
            pickup_at: "2030-01-10T15:00:00Z",
            timezone: "America/New_York",
            agreed_end_at: null,
            hold_expires_at: "2030-01-09T15:00:00Z",
            version: 2,
            applicant_name: "Synthetic Applicant",
            vehicle_label: "TEST Ford Fusion",
            warnings: ["Readiness must be rechecked before allocation"],
          };
          window.api = async (kind, data) => {
            window.calls.push({ kind, data });
            if (window.disabled)
              return {
                available: false,
                message: "Reservations are unavailable. Feature disabled or schema unavailable.",
              };
            if (kind === "change") {
              if (window.fail)
                return { available: false, message: "Allocation conflict. Reload availability." };
              return { available: true, value: { id }, canManage: true };
            }
            const value =
              kind === "list"
                ? [window.record]
                : kind === "history"
                  ? [
                      {
                        action: "reserved",
                        occurred_at: "2026-10-14T10:00:00Z",
                        from_state: "draft",
                        to_state: "reserved",
                      },
                    ]
                  : {
                      applicants: [
                        { id, name: "Synthetic Applicant", timezone: "America/New_York" },
                      ],
                      vehicles: [
                        {
                          id,
                          label: "TEST Ford Fusion",
                          timezone: "America/New_York",
                          reasons: [],
                          conflict: data.pickupAt ? true : null,
                        },
                        {
                          id: "22222222-2222-4222-8222-222222222222",
                          label: "TEST Held Vehicle",
                          timezone: "America/New_York",
                          reasons: ["Maintenance hold"],
                          conflict: null,
                        },
                      ],
                    };
            return { available: true, value, canManage: role !== "coordinator" };
          };
        },
        { role },
      );
      await page.goto(origin);
      await page.getByRole("button", { name: /Synthetic Applicant/ }).click();
      await page.getByText("Transition History", { exact: true }).waitFor();
      assert.match(
        await page.getByRole("link", { name: "View Applicant" }).getAttribute("href"),
        /tab=drivers&id=1111/,
      );
      if (role === "coordinator") {
        assert.equal(
          await page.getByRole("button", { name: "Create Reservation", exact: true }).count(),
          0,
        );
        assert.equal(
          await page.getByRole("button", { name: "Confirm Reservation", exact: true }).count(),
          0,
        );
        assert.equal(
          (await page.evaluate(() => window.calls)).some(
            (c) => c.kind === "options" || c.kind === "change",
          ),
          false,
        );
      } else {
        await page.getByRole("button", { name: "Confirm Reservation", exact: true }).click();
        await page
          .getByText("Reservation updated. No rental was activated and no payment was collected.")
          .waitFor();
        assert.equal(
          (await page.evaluate(() => window.calls.filter((c) => c.kind === "change")))[0].data
            .action,
          "confirm",
        );
        await page.evaluate(() => {
          window.record.state = "draft";
        });
        await page.getByRole("button", { name: "Reload", exact: true }).click();
        await page.getByRole("button", { name: /Synthetic Applicant/ }).click();
        await page.getByRole("button", { name: "Reserve (24 Hours)", exact: true }).click();
        await page
          .getByText("Reservation updated. No rental was activated and no payment was collected.")
          .waitFor();
        await page.evaluate(() => {
          window.record.state = "reserved";
          window.record.hold_expires_at = "2000-01-01T00:00:00Z";
        });
        await page.getByRole("button", { name: "Reload", exact: true }).click();
        await page.getByRole("button", { name: /Synthetic Applicant/ }).click();
        await page.getByRole("button", { name: "Expire Hold", exact: true }).click();
        await page
          .getByText("Reservation updated. No rental was activated and no payment was collected.")
          .waitFor();
        await page.evaluate(() => {
          window.record.hold_expires_at = "2030-01-09T15:00:00Z";
        });
        await page.getByRole("button", { name: "Reload", exact: true }).click();
        await page.getByRole("button", { name: "Create Reservation", exact: true }).click();
        await page
          .getByLabel("Applicant", { exact: true })
          .selectOption("11111111-1111-4111-8111-111111111111");
        await page
          .getByLabel("Vehicle", { exact: true })
          .selectOption("11111111-1111-4111-8111-111111111111");
        assert.equal(
          await page
            .getByRole("option", { name: /TEST Held Vehicle/ })
            .evaluate((el) => el.disabled),
          true,
        );
        await page.getByLabel("Pickup date/time", { exact: true }).fill("2030-01-10T10:00");
        await page.getByLabel("Pickup UTC offset", { exact: true }).fill("-05:00");
        await page
          .getByText("Reservation conflict — allocation will be refused.", { exact: true })
          .waitFor();
        await page.evaluate(() => (window.fail = true));
        await page.getByRole("button", { name: "Create Draft", exact: true }).click();
        await page
          .getByText("Allocation conflict. Reload availability.", { exact: true })
          .waitFor();
        assert.equal(await page.getByRole("form", { name: "Reservation editor" }).count(), 1);
        await page.evaluate(() => (window.fail = false));
        await page.getByRole("button", { name: "Create Draft", exact: true }).click();
        await page
          .getByText("Reservation draft created. Open Drafts to review and reserve.")
          .waitFor();
        await page.getByRole("button", { name: /Synthetic Applicant/ }).click();
        await page.getByRole("button", { name: "Reschedule / Reassign", exact: true }).click();
        await page.getByRole("button", { name: "Save Schedule", exact: true }).click();
        await page
          .getByText("Reservation updated. No rental was activated and no payment was collected.")
          .waitFor();
        await page.getByRole("button", { name: /Synthetic Applicant/ }).click();
        await page
          .getByLabel("Cancellation reason", { exact: true })
          .fill("Synthetic cancellation");
        await page.getByRole("button", { name: "Cancel Reservation", exact: true }).click();
        await page
          .getByText("Reservation updated. No rental was activated and no payment was collected.")
          .waitFor();
        if (width === 1440 && role === "manager") {
          await page.getByRole("button", { name: "Create Reservation", exact: true }).click();
          mkdirSync("/private/tmp/rr-reservation-ui-evidence", { recursive: true });
          await page.screenshot({
            path: "/private/tmp/rr-reservation-ui-evidence/manager.png",
            fullPage: true,
          });
        }
      }
      await page.evaluate(() => (window.disabled = true));
      await page.getByRole("button", { name: "Reload", exact: true }).click();
      await page
        .getByText("Reservations are unavailable. Feature disabled or schema unavailable.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Create Reservation", exact: true }).count(),
        0,
      );
      assert.equal(
        (await page.evaluate(() => window.calls.filter((c) => c.kind === "change"))).some(
          (c) => c.data.action === "convert",
        ),
        false,
      );
      if (css)
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
        );
      await page.close();
      n++;
    }
  console.log(`${n} responsive role/workflow scenarios passed; CSS=${Boolean(css)}`);
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
