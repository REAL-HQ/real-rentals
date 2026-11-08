/** Isolated real Edit Details drawer. Synthetic client/server fixtures only.
 * Run npm run build, then PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/vehicle-save-browser.test.mjs
 * The endpoint/persistence contract is separately tested in vehicle-onboarding-phase2.test.mjs.
 */
import assert from "node:assert/strict";
import {build} from "esbuild";
import ts from "typescript";
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const out=resolve('.vehicle-save-build'); mkdirSync(out,{recursive:true});
const source=readFileSync('src/components/admin/VehicleProfile.tsx','utf8');
const sf=ts.createSourceFile('profile.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const server=readFileSync('src/lib/vehicles.functions.ts','utf8');
const ss=ts.createSourceFile('server.ts',server,ts.ScriptTarget.Latest,true);
function declaration(tree,name){ for(const n of tree.statements){if(ts.isFunctionDeclaration(n)&&n.name?.text===name) return n.getText(tree);if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)===name)) return n.getText(tree).replace(/^export /,'');}throw Error(`Missing real declaration ${name}`); }
const extracted=['SECTION_META','titleCase','SectionDrawer'].map(n=>declaration(sf,n)).join('\n');
const enums=['VEHICLE_STATUSES','BODY_TYPES'].map(n=>declaration(ss,n)).join('\n');
const code=`import React,{useState,useEffect,useRef} from 'react';import{createRoot}from'react-dom/client';
import{Car,ShieldCheck,ScrollText,Satellite,KeyRound,Wrench}from'lucide-react';
import{Text,Area,NumberField,DateInput,Choice}from'./src/components/admin/VehicleProfileFields';
import{VehicleEditDrawer}from'./src/components/admin/VehicleEditDrawer';import{MicroLabel}from'./src/components/admin/ui';import{usStateOptions}from'./src/lib/us-states';
const useUnsavedGuard=()=>{};const confirmLeaveIfUnsaved=()=>true;const toast={success(){},info(){},error(){}};const updateVehicleSection={};const useServerFn=()=>globalThis.__fixtureSave;
${enums}\n${extracted}
const original={id:'dddddddd-0000-4000-8000-000000000002',unit_number:'SYN-002',year:2013,make:'Ford',model:'Fusion',vin:'1HGCM82633A004352',status:'onboarding',weekly_rate:null,color:'Black',body_type:'sedan',license_plate:'KEEP456',plate_state:'FL'};
let persisted={...original};
function Preview(){
 const[open,setOpen]=useState(true);const[snapshot,setSnapshot]=useState(persisted);const[request,setRequest]=useState(null);const[writePatch,setWritePatch]=useState(null);
 globalThis.__fixtureSave=async({data})=>{
  setRequest(data);
  const patch=Object.fromEntries(data.intended.map(k=>[k,['license_plate','plate_state'].includes(k)?String(data.values[k]).trim().toUpperCase():data.values[k]]));
  for(const k of['status','weekly_rate'])if(k in patch&&patch[k]===persisted[k])delete patch[k];
  setWritePatch(patch);
  if(globalThis.__fixtureMode==='network')throw Error('Network');
  if(globalThis.__fixtureMode==='permission')throw Error('Forbidden');
  if(globalThis.__fixtureMode==='unconfirmed')return{ok:false,error:'Some changes could not be confirmed. Your draft is still here; refresh the record before trying again.'};
  const candidate={...persisted,...patch};
  if(['available','reserved'].includes(candidate.status)){
   const missing=[];if(candidate.year==null)missing.push('year');if(!candidate.make?.trim())missing.push('make');if(!candidate.model?.trim())missing.push('model');if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(candidate.vin||''))missing.push('a valid VIN');if(!(Number.isFinite(Number(candidate.weekly_rate))&&Number(candidate.weekly_rate)>0))missing.push('a weekly rate above $0');
   if(missing.length)return{ok:false,field:'status',error:'Not rental ready yet — add '+missing.join(' and ')+' first.'};
  }
  persisted=candidate;
  return{ok:true,saved:Object.keys(patch).map(k=>({field:k,label:k.replaceAll('_',' ')}))};
 };
 return <><h1>Synthetic Save Review</h1><p>LOCAL FIXTURE ONLY. No network, real writes or real records. Actual Edit Details component; server response simulated. PostgreSQL behavior is tested separately with the real migration.</p><section style={{maxWidth:460,padding:16}}><h2>Submitted Client Request</h2><output aria-label="Submitted Client Request">{JSON.stringify(request)}</output><h2>Normalized Server Write Patch</h2><output aria-label="Server Write Patch">{JSON.stringify(writePatch)}</output><h2>Last Confirmed Persisted Row</h2><output aria-label="Persisted Details">{JSON.stringify(snapshot)}</output></section>{open&&<SectionDrawer section="identity" vehicleId={original.id} vehicle={original} onClose={()=>setOpen(false)} onSaved={()=>{setSnapshot({...persisted});setOpen(false);}}/>}</>;
};createRoot(document.getElementById('root')).render(<Preview/>);`;
const bundle=await build({stdin:{contents:code,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':resolve('src')},write:false,define:{'process.env.NODE_ENV':'"production"'}});
const assets=resolve('.output/public/assets');const css=readFileSync(`${assets}/${readdirSync(assets).find(n=>/^styles-.*\.css$/.test(n))}`,'utf8');
const file=`${out}/edit-details.html`;writeFileSync(file,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Edit Details Save</title><style>${css}body{margin:0}output{display:block;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`);console.log(file);
if(process.env.FIXTURE_ONLY)process.exit(0);
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const browser=await chromium.launch();let checks=0;
try{for(const width of[390,1024]){const page=await browser.newPage({viewport:{width,height:985}});await page.route('http**/*',r=>r.abort());await page.goto(pathToFileURL(file).href);
const field=name=>page.locator('label').filter({has:page.getByText(name,{exact:true})});
await field('Color').locator('input').fill('Silver');await field('Body Type').locator('select').selectOption('sedan');await field('License Plate').locator('input').fill('SYN789');await field('Plate State').locator('select').selectOption('FL');await field('Status').locator('select').selectOption('available');await page.getByRole('button',{name:'Save Changes'}).click();const alert=page.getByRole('alert');await alert.waitFor();assert((await alert.textContent()).includes('weekly rate'),'status failure is visible');assert(await alert.evaluate(e=>document.activeElement===e),'error receives focus');assert.equal(await field('Color').locator('input').inputValue(),'Silver');assert.equal(await field('License Plate').locator('input').inputValue(),'SYN789');assert(await page.getByText('Edit Details',{exact:true}).isVisible(),'drawer remains open after failure');await page.screenshot({path:`${out}/blocked-${width}.png`,fullPage:true});
await field('Status').locator('select').selectOption('onboarding');await page.getByRole('button',{name:'Save Changes'}).click();await page.getByText('Edit Details',{exact:true}).waitFor({state:'hidden'});const persisted=JSON.parse(await page.getByLabel('Persisted Details').textContent());assert.equal(persisted.color,'Silver');assert.equal(persisted.body_type,'sedan');assert.equal(persisted.license_plate,'SYN789');assert.equal(persisted.status,'onboarding');checks++;console.log(`PASS visible failure, preserved draft and successful readback at ${width}px`);await page.close();}
// Regression: only rate/status were edited; existing non-null details survive.
{const page=await browser.newPage({viewport:{width:1024,height:985}});await page.route('http**/*',r=>r.abort());await page.goto(pathToFileURL(file).href);const field=name=>page.locator('label').filter({has:page.getByText(name,{exact:true})});await field('Weekly Rate').locator('input').fill('350');await field('Status').locator('select').selectOption('available');await page.getByRole('button',{name:'Save Changes'}).click();await page.getByText('Edit Details',{exact:true}).waitFor({state:'hidden'});const confirmed=JSON.parse(await page.getByLabel('Persisted Details').textContent());const patch=JSON.parse(await page.getByLabel('Server Write Patch').textContent());assert.deepEqual(Object.keys(patch).sort(),['status','weekly_rate']);assert.equal(confirmed.status,'available');assert.equal(confirmed.weekly_rate,350);assert.equal(confirmed.body_type,'sedan');assert.equal(confirmed.license_plate,'KEEP456');assert.equal(confirmed.plate_state,'FL');assert.equal(confirmed.color,'Black');checks++;console.log('PASS rate plus Available request patch contains only edits and preserves existing details');await page.screenshot({path:`${out}/confirmed-readback-1024.png`,fullPage:true});await page.close();}
for(const mode of['network','permission','unconfirmed']){const page=await browser.newPage();await page.route('http**/*',r=>r.abort());await page.goto(pathToFileURL(file).href);await page.locator('label').filter({has:page.getByText('Color',{exact:true})}).locator('input').fill('Blue');await page.evaluate(m=>{globalThis.__fixtureMode=m;},mode);await page.getByRole('button',{name:'Save Changes'}).click();const alert=page.getByRole('alert');await alert.waitFor();assert((await alert.textContent()).includes(mode==='permission'?'Manager-only':mode==='unconfirmed'?'could not be confirmed':'still here'));assert.equal(await page.locator('label').filter({has:page.getByText('Color',{exact:true})}).locator('input').inputValue(),'Blue');checks++;console.log(`PASS ${mode} failure visible with draft preserved`);await page.close();}
}finally{await browser.close();}console.log(`${checks} real-drawer browser scenarios passed`);
