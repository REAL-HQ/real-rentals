/** Real VehiclesPanel SSR + production CSS, geometry tested in Chromium.
 * Run npm run build, then PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/toolbar-layout.test.mjs
 * No live app, customer data, or network access.
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
await import("./toolbar-layout-fixture.mjs");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
let checks = 0;
try {
 for (const variant of ["default", "filtered", "maintenance"]) {
  for (const width of [320, 390, 768, 1024, 1280, 1600]) {
   const page = await browser.newPage({ viewport: { width, height: 985 } });
   await page.route("http**/*", r => r.abort());
   await page.goto(pathToFileURL(resolve(`.toolbar-layout-build/${variant}.html`)).href);
   await page.getByRole("combobox",{name:"Status",exact:true}).waitFor();
   await page.waitForFunction(() => document.querySelector('[aria-label="Status"]')?.textContent?.includes("All Statuses"));
   const layout = await page.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    const visible = el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== "none";
    const primary = document.querySelector('[data-toolbar-primary]');
    const filters = document.querySelector('[data-toolbar-filters]');
    const actions = document.querySelector('[data-toolbar-actions]');
    const table = document.querySelector('[aria-label="Vehicles table"]');
    return { page:document.documentElement.scrollWidth, window:innerWidth, primary:rect(primary), filters:rect(filters), search:rect(document.querySelector('[data-toolbar-search] input')), selects:[...filters.querySelectorAll('[role="combobox"]')].map(rect), actions:[...actions.children].filter(visible).map(rect), controls:[...actions.querySelectorAll('button')].filter(visible).map(rect), actionBox:rect(actions), table:table && { ...rect(table), scrollWidth:table.scrollWidth, clientWidth:table.clientWidth, overflow:getComputedStyle(table).overflowX }, context:rect(document.querySelector('[data-toolbar-context]')) };
   });
   const label = `${variant} at ${width}px`;
   assert(layout.page <= width + 1, `${label}: no page overflow ${JSON.stringify(layout)}`);
   assert(layout.filters.y >= layout.primary.bottom - 1, `${label}: filters below primary row`);
   assert(layout.context.y >= layout.filters.bottom - 1, `${label}: context below filters`);
   assert.equal(layout.selects.length, 4, `${label}: four filter controls`);
   for (const r of [...layout.actions, ...layout.selects, layout.search]) {
    assert(Math.abs(r.height - 36) < 1, `${label}: consistent control height ${JSON.stringify(r)}`);
    assert(r.x >= 0 && r.right <= width + 1, `${label}: all controls reachable`);
   }
   for (let i=1;i<layout.selects.length;i++) assert(Math.abs(layout.selects[i].width-layout.selects[0].width)<1, `${label}: equal grid cells`);
   const ys = new Set(layout.selects.map(r => Math.round(r.y)));
   assert.equal(ys.size, layout.filters.width > 640 ? 1 : 2, `${label}: intentional filter rows`);
   if (layout.filters.width > 640) {
    assert(Math.abs(layout.actionBox.y-layout.search.y)<1, `${label}: actions align with search, never filter midpoint`);
    assert.equal(new Set(layout.actions.map(r => Math.round(r.y))).size,1, `${label}: actions one row`);
   }
   if (width >= 768) {
    assert.equal(layout.table.overflow,"auto", `${label}: scoped table scrolling, not clipping`);
    await page.locator('[aria-label="Vehicles table"]').evaluate(el => { el.scrollLeft=el.scrollWidth; });
    const open = page.locator('table button').last();
    const box = await open.boundingBox();
    assert(box.x >= layout.table.x && box.x + box.width <= layout.table.right+1, `${label}: Open reachable after table scroll`);
   }
   if (width >= 768) await page.locator('[aria-label="Vehicles table"]').evaluate(el => { el.scrollLeft=0; });
   if (variant === "default" && [390,1024,1280].includes(width)) await page.screenshot({ path: `.toolbar-layout-build/vehicles-${width}.png`, fullPage:true });
   checks++;
   console.log(`PASS ${label}`);
   await page.close();
  }
 }
 // Selection tests use the real drawer and Radix portal, not native menu CSS.
 for (const width of [390, 1024]) {
  const page = await browser.newPage({ viewport:{width,height:985} });
  await page.route("http**/*", r => r.abort());
  await page.goto(pathToFileURL(resolve('.toolbar-layout-build/body-type.html')).href);
  const trigger = page.getByRole('combobox', {name:'Body Type'});
  await trigger.click();
  const popup = page.getByRole('listbox');
  await popup.waitFor();
  assert.equal(await popup.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)', 'actual open popup is white');
  assert.equal(await popup.evaluate(el=>getComputedStyle(el).zIndex),'70','popup above z-60 drawer');
  const labels = await popup.getByRole('option').allTextContents();
  assert.deepEqual(labels.map(x=>x.trim()), ['—','Sedan','SUV','XL','Truck','Van','Minivan','Coupe','Hatchback','Wagon','Convertible','Other']);
  await page.getByRole('option',{name:'SUV',exact:true}).click();
  assert.equal(await page.getByLabel('Stored value').textContent(),'suv','visible SUV keeps stored lowercase enum');
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  await popup.waitFor(); await page.keyboard.press('End'); await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Other'); await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('Stored value').textContent(),'other','keyboard selection uses unchanged value');
  await trigger.click(); await page.keyboard.press('Escape');
  await popup.waitFor({state:'hidden'});
  assert(await page.getByText('Edit Vehicle Details',{exact:true}).isVisible(),'Escape closes menu, not editor');
  await trigger.click(); await page.getByRole('option',{name:'—',exact:true}).click();
  assert.equal(await page.getByLabel('Stored value').textContent(),'(empty)','unset round trips to empty stored value');
  await popup.waitFor({state:'hidden'});
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Body Type');
  assert(await trigger.evaluate(el=>document.activeElement===el),'focus returns to trigger');
  await trigger.click();
  await popup.waitFor();
  await page.screenshot({path:`.toolbar-layout-build/body-type-${width}.png`,fullPage:true});
  console.log(`PASS body-type popup and keyboard semantics at ${width}px`);
  checks++;
  await page.close();
 }
} finally { await browser.close(); }
console.log(`${checks} actual-component responsive layout scenarios passed`);
