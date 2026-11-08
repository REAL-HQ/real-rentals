/** Actual DriversPanel -> actual InlineActivationFlow -> actual ActivateRentalDialog + insurance editor.
 * Offline synthetic responses only. No real credentials, network, writes, sends or activation.
 * Build first. FIXTURE_ONLY=1 leaves a self-contained parent-review file.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import ts from "typescript";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const out = resolve('.inline-activation-browser'); mkdirSync(out, { recursive: true });
const prelude = String.raw`
const id='dddddddd-0000-4000-8000-000000000001', vehicleId='eeeeeeee-0000-4000-8000-000000000001';
const initialMode=location.hash.slice(1)||'ready';
globalThis.__fixtureState={mode:initialMode,active:initialMode==='already',insured:initialMode!=='insurance',calls:[]};
const S=globalThis.__fixtureState;
const driver={id,full_name:'Synthetic Driver',email:'synthetic@example.invalid',phone:'2025550100',status:'approved',vehicle_id:vehicleId,created_at:'2026-11-08T12:00:00Z',sms_consent:true};
const vehicle={id:vehicleId,unit_number:'SYN-001',year:2020,make:'Toyota',model:'Camry',vin:'1HGCM82633A004352',status:'available',weekly_rate:350,deposit:200,current_odometer:12345};
globalThis.__fixtureDb={vehicles:[vehicle],driver_screenings:[{id:'screen-1',lead_id:id,insurance_verified:S.insured,interview_completed_at:'2026-11-08T12:00:00Z'}],documents:[],inspection_templates:[{id:'template-1',name:'Pre-Delivery Checklist',inspection_type:'pre_delivery',is_active:true}]};
function readiness(){
 const blockers=[];
 if(S.active)blockers.push({code:'already_active',message:'This driver already has an active rental.'});
 else if(S.mode==='insurance'&&!S.insured)blockers.push({code:'insurance_not_verified',message:'Insurance verification is required. Review and verify the evidence before activating.'});
 else if(S.mode==='blocked')blockers.push({code:'vehicle_busy',message:'That vehicle is already on an active rental with another driver.'});
 else if(S.mode==='inspection')blockers.push({code:'no_passed_inspection',message:'No passed pre-delivery inspection for this vehicle. Run the checklist first.'});
 else if(S.mode==='email')blockers.push({code:'no_email',message:'No email is on file.'});
 else if(S.mode==='approval')blockers.push({code:'not_approved',message:'Application must be approved.'});
 else if(S.mode==='agreement')blockers.push({code:'no_signed_agreement',message:'A signed agreement is required.'});
 return{ready:!blockers.length,blockers,warnings:[],suggestedWeeklyRate:350,suggestedDeposit:200,inspectionMileage:12345,currentMileage:12345,insurance:{status:S.insured?'verified':'missing',exceptionAllowed:false,settingPresent:true,settingReadable:true},requirements:[{key:'approved',label:'Application Approved',met:true,enforcement:'hard'},{key:'license_documents',label:'License Front And Back',met:true,enforcement:'hard'},{key:'signed_agreement',label:'Signed Agreement',met:true,enforcement:'hard'},{key:'insurance_verified',label:'Insurance Verification',met:S.insured,enforcement:'hard'},{key:'inspection',label:'Pre-Delivery Inspection',met:true,enforcement:'hard'}]};
}
globalThis.__fixtureApi=async(name,args)=>{
 S.calls.push({name,data:args?.data});
 if(name==='listDriverRows')return{rows:[{...driver,status:S.active?'active':driver.status}],canSeeSensitive:false};
 if(name==='listDriverActiveSets')return{openRentalIds:S.active?[id]:[],authoritativeIds:S.active?[id]:[]};
 if(name==='listWaitlist')return{entries:[]};
 if(name==='listWaitlistHolds')return{holds:[]};
 if(name==='getDriverPayStatuses')return{};
 if(name==='getActivationReadiness'){if(S.mode==='readfailure')throw Error('Synthetic readiness read failed. Nothing was activated.');return readiness();}
 if(name==='activateRental'){
   await new Promise(r=>setTimeout(r,150));
   if(S.mode==='network')throw Error('Synthetic network failure. Your draft is still here.');
   if(S.mode==='permission')throw Error('Forbidden: Manager access is required.');
   if(S.mode==='race'){S.active=true;return{ok:false,blockers:[{code:'already_active',message:'This driver already has an active rental.'}]};}
   if(S.active)return{ok:false,blockers:[{code:'already_active',message:'This driver already has an active rental.'}]};
   if(!S.insured)return{ok:false,blockers:[{code:'insurance_not_verified',message:'Insurance is not verified.'}]};
   S.active=true;return{ok:true,accountCreated:false};
 }
 if(name==='setInsuranceVerification'){S.insured=!!args.data.verified;globalThis.__fixtureDb.driver_screenings[0].insurance_verified=S.insured;return{ok:true};}
 if(name==='getInsuranceVerificationActivity')return{lastRequest:null};
 if(name==='adminListDriverDocuments')return[];
 if(name==='fillActivationEmail'){driver.email=args.data.email;S.mode='ready';return{ok:true,email:args.data.email,auditError:null};}
 if(name==='approveApplication'){driver.status='approved';S.mode='ready';return{ok:true};}
 if(name==='updateApplicationLifecycle'){Object.assign(driver,args.data.patch);return{...args.data.patch};}
 if(name==='previewAgreement')return{pdfBase64:null,fingerprint:null,canSend:false,sendRefusal:null,blockers:[],merge:{driver_name:'Synthetic Driver'},terms:null,template:{label:'Synthetic Draft'},companyMissing:[]};
 if(name==='getOnboardingChecklist')return{drivers:[]};
 return[];
};
`;
const browserSupabase = String.raw`
class Query{constructor(table){this.table=table;this.filters=[];}select(){return this;}order(){return this;}limit(){return this;}not(){return this;}is(){return this;}eq(key,value){this.filters.push([key,value]);return this;}
result(){const error=globalThis.__fixtureState.mode==='screeningfailure'&&this.table==='driver_screenings'?{message:'Synthetic screening read failed'}:null;return{data:(globalThis.__fixtureDb[this.table]??[]).filter(row=>this.filters.every(([k,v])=>row[k]===v)),error};}
then(a,b){return Promise.resolve(this.result()).then(a,b);}maybeSingle(){const r=this.result();return Promise.resolve({...r,data:r.data[0]??null});}}
export const supabase={from:table=>new Query(table)};
`;
const stubs = {
 '@tanstack/react-start': `export const useServerFn=fn=>fn;`,
 '@tanstack/react-router': `import React from 'react';const nav=()=>{};export const useNavigate=()=>nav;export const useSearch=()=>({});export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);`,
 '@/integrations/supabase/client': browserSupabase,
};
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{DriversPanel}from'./src/components/admin/DriversPanel';createRoot(document.getElementById('root')).render(<DriversPanel isManager={globalThis.__fixtureState.mode!=='coordinator'}/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle:true, format:'iife', platform:'browser', jsx:'automatic', alias:{'@':resolve('src')}, write:false, define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'}, plugins:[{name:'offline-transport-only',setup(b){
 b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'stub'}:undefined);
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js',resolveDir:process.cwd()}));
 b.onResolve({filter:/\.functions(?:\.ts)?$/},args=>{let path=args.path.startsWith('@/')?resolve('src',args.path.slice(2)):resolve(args.resolveDir,args.path);if(!existsSync(path))path+='.ts';return{path,namespace:'endpoint'};});
 b.onLoad({filter:/.*/,namespace:'endpoint'},args=>{
   const source=readFileSync(args.path,'utf8');const tree=ts.createSourceFile(args.path,source,ts.ScriptTarget.Latest,true);const exports=[];
   for(const node of tree.statements){if(!node.modifiers?.some(x=>x.kind===ts.SyntaxKind.ExportKeyword))continue;
    if(ts.isVariableStatement(node))for(const d of node.declarationList.declarations){const name=d.name.getText(tree);const value=d.initializer?.getText(tree)||'';
      if(!value.includes('createServerFn')&&/^\s*(?:\[|\{|["'`]|\d|true\b|false\b)/.test(value))exports.push('export const '+name+'='+value+';');
      else exports.push('export const '+name+'=async args=>globalThis.__fixtureApi('+JSON.stringify(name)+',args);');}
    else if(ts.isFunctionDeclaration(node)&&node.name)exports.push('export const '+node.name.text+'=async args=>globalThis.__fixtureApi('+JSON.stringify(node.name.text)+',args);');
   }
   return{contents:exports.join('\n'),loader:'ts'};
 });
}}] });
const assets=resolve('.output/public/assets');const css=readFileSync(`${assets}/${readdirSync(assets).find(n=>/^styles-.*\.css$/.test(n))}`,'utf8');
const file=`${out}/drivers.html`;
writeFileSync(file,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drivers Inline Activation — Synthetic</title><style>${css}body{margin:0;background:#fafafb}main{min-width:0;padding:24px}header.fixture{padding:12px;background:white;border-bottom:1px solid #ddd;font:14px sans-serif}@media(max-width:600px){main{padding:12px}}</style><header class="fixture">SYNTHETIC OFFLINE REVIEW · Real Drivers list and activation components · All server responses mocked · No real writes, sends, credentials or activation. Change URL hash to #insurance, #readfailure, #blocked or #coordinator, then reload.</header><main><h1 class="mb-4 text-xl font-semibold">Drivers</h1><div id="root"></div></main><script>${(prelude+'\n'+bundle.outputFiles[0].text).replaceAll('</script','<\/script')}</script>`);
console.log(file);
if(process.env.FIXTURE_ONLY)process.exit(0);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const browser=await chromium.launch();let checks=0;
async function pageFor(mode='ready',width=1280){const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',error=>console.error('BROWSER ERROR',error.message));await page.route('http**/*',r=>r.abort());await page.goto(pathToFileURL(file).href+'#'+mode);await page.getByRole('combobox',{name:'Application Status',exact:true}).waitFor();return page;}
const calls=(page,name)=>page.evaluate(name=>globalThis.__fixtureState.calls.filter(call=>call.name===name),name);
async function open(page){await page.getByRole('combobox',{name:'Application Status',exact:true}).click();await page.getByRole('option',{name:'Active',exact:true}).click();await page.getByRole('dialog',{name:'Activate Rental',exact:true}).waitFor();await page.waitForFunction(()=>!document.body.textContent.includes('Checking…'));assert.equal((await calls(page,'activateRental')).length,0);}
try{
 for(const width of [390,1024,1280]){const page=await pageFor('ready',width);await open(page);await page.getByRole('button',{name:'Activate Rental',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('[role=dialog] button:disabled')||Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Activate Rental'&&!b.disabled));const dialog=page.getByRole('dialog',{name:'Activate Rental',exact:true});const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);await page.screenshot({path:`${out}/ready-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Activate Rental',exact:true}).evaluate(button=>{button.click();button.click();});await page.keyboard.press('Escape');assert(await dialog.isVisible(),'in-flight activation cannot be dismissed');await dialog.waitFor({state:'hidden'});assert.equal((await calls(page,'activateRental')).length,1);await page.getByRole('button',{name:'Active (1)',exact:true}).waitFor();checks++;await page.close();}
 {const page=await pageFor('insurance');await open(page);await page.getByLabel('Weekly Rate',{exact:true}).fill('375');await page.getByLabel('Pickup Mileage',{exact:true}).fill('12399');await page.getByRole('button',{name:'Verify Insurance',exact:true}).click();await page.getByText('Insurance Verification Call',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),1);assert.equal((await calls(page,'setInsuranceVerification')).length,0);await page.screenshot({path:`${out}/insurance-inline-1280.png`,fullPage:true});await page.getByRole('button',{name:'Yes',exact:true}).click();await page.getByRole('button',{name:'Activate Rental',exact:true}).waitFor();assert.equal((await calls(page,'setInsuranceVerification')).length,1);assert.equal((await calls(page,'activateRental')).length,0);assert.equal(await page.getByLabel('Weekly Rate',{exact:true}).inputValue(),'375');assert.equal(await page.getByLabel('Pickup Mileage',{exact:true}).inputValue(),'12399');await page.getByRole('button',{name:'Activate Rental',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:'Active (1)',exact:true}).waitFor();checks++;await page.close();}
 for(const mode of ['network','permission']){const page=await pageFor(mode);await open(page);await page.getByLabel('Weekly Rate',{exact:true}).fill('411');await page.getByLabel('Pickup Mileage',{exact:true}).fill('12400');await page.getByRole('button',{name:'Activate Rental',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Weekly Rate',{exact:true}).inputValue(),'411');assert.equal(await page.getByLabel('Pickup Mileage',{exact:true}).inputValue(),'12400');assert(await page.getByRole('dialog').isVisible());assert.equal((await calls(page,'activateRental')).length,1);await page.getByRole('button',{name:'Active (0)',exact:true}).waitFor();await page.evaluate(()=>globalThis.__fixtureState.mode='ready');await page.getByRole('button',{name:'Retry Readiness Check',exact:true}).click();await page.getByRole('button',{name:'Activate Rental',exact:true}).waitFor();assert.equal(await page.getByLabel('Weekly Rate',{exact:true}).inputValue(),'411');checks++;await page.close();}
 {const page=await pageFor('readfailure');await open(page);await page.getByRole('alert').waitFor();assert.equal((await calls(page,'activateRental')).length,0);assert.equal(await page.getByRole('button',{name:'Activate Rental',exact:true}).count(),0);await page.evaluate(()=>globalThis.__fixtureState.mode='ready');await page.getByRole('button',{name:'Retry Readiness Check',exact:true}).click();await page.getByRole('button',{name:'Activate Rental',exact:true}).waitFor();checks++;await page.close();}
 {const page=await pageFor('race');await open(page);await page.getByRole('button',{name:'Activate Rental',exact:true}).click();await page.getByRole('button',{name:'Refresh List',exact:true}).waitFor();await page.getByRole('button',{name:'Refresh List',exact:true}).click();await page.getByRole('button',{name:'Active (1)',exact:true}).waitFor();assert.equal((await calls(page,'activateRental')).length,1);await page.getByRole('combobox',{name:'Application Status',exact:true}).click();assert.equal(await page.getByRole('option',{name:'Active',exact:true}).getAttribute('data-disabled'),'');checks++;await page.close();}
 {const page=await pageFor('coordinator');await page.getByRole('combobox',{name:'Application Status',exact:true}).click();assert.equal(await page.getByRole('option',{name:'Active',exact:true}).getAttribute('data-disabled'),'');assert.equal((await calls(page,'activateRental')).length,0);checks++;await page.close();}
 {const page=await pageFor('blocked');await open(page);assert(await page.getByRole('button',{name:'Activate Rental',exact:true}).isDisabled());assert((await page.getByText('That vehicle is already on an active rental with another driver.').textContent()).includes('another driver'));await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id?.startsWith('driver-status-'));checks++;await page.close();}

 {const page=await pageFor('ready');await open(page);await page.getByRole('combobox',{name:'Vehicle',exact:true}).click();await page.getByPlaceholder('Search plate, VIN, unit, make…').waitFor();await page.keyboard.press('Escape');await page.getByPlaceholder('Search plate, VIN, unit, make…').waitFor({state:'hidden'});assert(await page.getByRole('dialog',{name:'Activate Rental',exact:true}).isVisible(),'Escape closes the popup first');await page.getByRole('button',{name:'Activate Rental',exact:true}).focus();await page.keyboard.press('Tab');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Close');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement?.textContent.trim()),'Activate Rental');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.id?.startsWith('driver-status-'));assert.equal((await calls(page,'activateRental')).length,0);checks++;await page.close();}
 {const page=await pageFor('inspection');await open(page);await page.getByRole('button',{name:'Complete Pre-Delivery Inspection',exact:true}).click();await page.getByRole('combobox',{name:'Inspection Checklist',exact:true}).click();const list=page.getByRole('listbox');await list.waitFor();assert.equal(await list.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');await page.keyboard.press('Escape');await list.waitFor({state:'hidden'});assert(await page.getByRole('dialog',{name:'Activate Rental',exact:true}).isVisible());assert.equal((await calls(page,'startInspection')).length,0);checks++;await page.close();}
 {const page=await pageFor('email');await open(page);await page.getByRole('button',{name:'Add Email',exact:true}).click();await page.getByLabel('Driver Email',{exact:true}).fill('confirmed@example.invalid');await page.getByRole('button',{name:'Save Email',exact:true}).click();await page.getByRole('button',{name:'Activate Rental',exact:true}).waitFor();assert.equal((await calls(page,'fillActivationEmail'))[0].data.email,'confirmed@example.invalid');assert.equal((await calls(page,'activateRental')).length,0);checks++;await page.close();}
 {const page=await pageFor('approval');await open(page);await page.getByRole('button',{name:'Approve Application',exact:true}).click();await page.getByRole('button',{name:'Approve Application',exact:true}).click();await page.getByRole('button',{name:'Activate Rental',exact:true}).waitFor();assert.equal((await calls(page,'approveApplication')).length,1);assert.equal((await calls(page,'activateRental')).length,0);checks++;await page.close();}
 {const page=await pageFor('agreement');await open(page);await page.getByLabel('Weekly Rate',{exact:true}).fill('389');await page.getByRole('button',{name:'Review Rental Agreement',exact:true}).click();await page.getByRole('button',{name:'Save Details & Prepare Agreement',exact:true}).click();await page.getByRole('button',{name:'Prepare Agreement',exact:true}).click();await page.getByRole('group',{name:'Prepare Agreement',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.getByRole('group',{name:'Prepare Agreement',exact:true}).getByRole('tab').count(),0);const patch=(await calls(page,'updateApplicationLifecycle'))[0].data.patch;assert.equal(patch.weekly_rent,389);assert.equal(patch.vehicle_id,'eeeeeeee-0000-4000-8000-000000000001');assert(!('status' in patch)&&!('deposit_paid' in patch));assert.equal((await calls(page,'sendAgreement')).length,0);assert.equal((await calls(page,'activateRental')).length,0);checks++;await page.close();}
 console.log(`${checks} actual-list/real-dialog browser scenarios passed; all transports synthetic`);
}finally{await browser.close();}
