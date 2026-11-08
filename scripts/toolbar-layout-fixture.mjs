/** Offline layout fixture: real VehiclesPanel + AdminToolbar + Select + production CSS.
 * Only server/query/navigation/dialog dependencies are stubbed. Synthetic data;
 * no network or customer actions. Run after npm run build.
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const out = resolve(".toolbar-layout-build");
mkdirSync(out, { recursive: true });
const rows = Array.from({ length: 10 }, (_, i) => ({ id: `synthetic-${i}`, unit_number: `RR-${String(i + 1).padStart(3, "0")}`, year: 2013, make: "Ford", model: "Fusion", vin: "1HGCM82633A004352", status: "available", license_plate: null, weekly_rate: 350, partner_id: null, photo: null, readiness: "rental_ready", readinessGaps: [] }));
const result = { rows, total: 10, fleetTotal: 10, page: 1, pageSize: 50, statuses: ["available"], bodyTypes: ["sedan"], readinessCounts: { listing_ready: 0, rental_ready: 10, not_ready: 0 } };
const stubs = {
  "@tanstack/react-query": `export const keepPreviousData = x => x; export const useQuery = () => ({data: globalThis.__toolbarFixture, isPending:false, isPlaceholderData:false, refetch() {}});`,
  "@tanstack/react-start": `export const useServerFn = () => () => {};`,
  "@tanstack/react-router": `export const useNavigate = () => () => {};`,
  "@/lib/maintenance-due": `export const MAINTENANCE_DUE_ENABLED = true;`,
  "@/lib/vehicles-list.functions": `export const listVehicles = () => {};`,
  "@/integrations/supabase/client": `export const supabase = {from: () => ({select: () => ({order: () => Promise.resolve({data: []})})})};`,
  "./VehicleProfile": `export const VehicleProfile = () => null;`,
  "./AddVehicleDialog": `export const AddVehicleDialog = () => null;`,
  "./VehicleLifecycleDialog": `export const VehicleLifecycleDialog = () => null;`,
  "./MaintenanceDue": `export const MaintenanceDue = () => null;`,
  "./MaintenanceLog": `export const MaintenanceLogBadgeSource = ({children}) => children({}, false); export const MaintenanceLogBadge = () => null;`,
};
const panel = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {VehiclesPanel} from './src/components/admin/VehiclesPanel'; createRoot(document.getElementById('fixture-panel')).render(React.createElement(VehiclesPanel, globalThis.__toolbarProps));`, resolveDir: process.cwd(), loader: "tsx" }, bundle:true, format:"iife", platform:"browser", jsx:"automatic", alias:{"@":resolve("src")}, write:false, define:{"process.env.NODE_ENV":'"production"'}, plugins:[{name:"offline-fixture-only",setup(b){
 b.onResolve({filter:/.*/}, args => args.path in stubs ? {path:args.path,namespace:"fixture"} : undefined);
 b.onLoad({filter:/.*/,namespace:"fixture"}, args => ({contents:stubs[args.path],loader:"js"}));
}}] });
const assets = resolve(".output/public/assets");
const cssFile = readdirSync(assets).find(x => /^styles-.*\.css$/.test(x));
if (!cssFile) throw new Error("Run npm run build first: production CSS missing");
const css = readFileSync(`${assets}/${cssFile}`, "utf8");
for (const [name, props] of [["default", {}], ["filtered", { externalSearch: "Ford", listState: { ready: "rental_ready" } }], ["maintenance", { canSeeMaintenanceDue: true }]]) {
 const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vehicles layout — synthetic offline fixture</title><style>${css}</style><style>body{margin:0;background:#fafafb}.fixture-shell{display:flex;min-height:100vh}.fixture-sidebar{width:220px;flex-shrink:0;background:#141416;color:white;padding:24px;box-sizing:border-box}.fixture-main{flex:1;min-width:0;padding:32px}.fixture-note{font-size:12px;margin-bottom:24px;color:#666}@media(max-width:767px){.fixture-sidebar{display:none}.fixture-main{padding:16px}}</style></head><body><div class="fixture-shell"><aside class="fixture-sidebar">REAL RENTALS<br>Offline fixture</aside><main class="fixture-main"><p class="fixture-note">SYNTHETIC LAYOUT FIXTURE · real VehiclesPanel and production CSS · controls inactive · no network</p><h1 class="text-xl font-semibold">Vehicles</h1><p class="mb-5 text-sm text-muted-foreground">Fleet Inventory &amp; Vehicle Status</p><div id="fixture-panel"></div></main></div><script>globalThis.__toolbarFixture=${JSON.stringify(result)};globalThis.__toolbarProps=${JSON.stringify(props)};${panel.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
 writeFileSync(`${out}/${name}.html`, html);
 console.log(`${out}/${name}.html`);
}

// Interactive isolated body-type editor: actual field, Radix popup and drawer.
const editor = await build({ stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {VehicleBodyTypeSelect} from './src/components/admin/VehicleBodyTypeSelect'; import {VehicleEditDrawer} from './src/components/admin/VehicleEditDrawer'; function Preview(){ const [value,setValue]=useState('sedan'); const [open,setOpen]=useState(true); return <><p>SYNTHETIC FIELD FIXTURE — local draft only, no network or saving</p><output aria-label="Stored value">{value || '(empty)'}</output><button onClick={()=>setOpen(true)}>Open Editor</button>{open && <VehicleEditDrawer title="Edit Vehicle Details" saving={false} onClose={()=>setOpen(false)} onSave={()=>{}}><VehicleBodyTypeSelect value={value} onChange={setValue}/><p>Only the draft above changes. Save is intentionally inactive.</p></VehicleEditDrawer>}</> }; createRoot(document.getElementById('root')).render(<Preview/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle:true, format:'iife', platform:'browser', jsx:'automatic', alias:{'@':resolve('src')}, write:false, define:{'process.env.NODE_ENV':'"production"'} });
writeFileSync(`${out}/body-type.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Body Type — Synthetic Local Draft</title><style>${css}</style><div id="root"></div><script>${editor.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`);
console.log(`${out}/body-type.html`);
