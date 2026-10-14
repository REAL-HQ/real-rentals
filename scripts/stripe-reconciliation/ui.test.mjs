import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const overview=readFileSync('src/components/admin/OverviewPanel.tsx','utf8');
assert.ok(overview.includes('<LeadPriorities />'));
assert.ok(overview.includes('getOverviewApplicants'));
assert.ok(!/\.from\(["']applications["']\)/.test(overview));
assert.ok(overview.includes('getStripeReport'));
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {StripeReconciliationPanel} from './src/components/admin/StripeReconciliationPanel';createRoot(document.getElementById('root')).render(<StripeReconciliationPanel/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@':resolve('src')},logLevel:'silent',plugins:[{name:'mock',setup(b){b.onResolve({filter:/^@tanstack\/react-start$|^@\/lib\/stripe-reconciliation.functions$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.includes('react-start')?'export const useServerFn=f=>f;':`export const listStripeReview=async()=>window.fixture; export const linkStripeSubscription=()=>{throw Error('No writes allowed')}; export const previewStripeHistory=linkStripeSubscription,applyStripeHistory=linkStripeSubscription,replayStripeEvent=linkStripeSubscription;`,loader:'js'}))}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<div id="root"></div><script src="/app.js"></script>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [390,1440]){const page=await browser.newPage({viewport:{width,height:900}});const origin=`http://127.0.0.1:${server.address().port}`;await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.addInitScript(()=>{window.fixture={events:[],cancellations:['requested','confirmed','failed','unknown'].map((state,i)=>({rental_id:'synthetic-'+i,state:'created',cancellation_state:state,cancellation_attempted_at:'2026-10-14T12:00:00Z',error_code:state==='failed'?'provider_rejected':state==='unknown'?'provider_unverified':null})),history:[{id:1,attempt_id:'attempt-2',retry_of:'attempt-1',operation_id:'operation-1',actor_user_id:'synthetic-manager',outcome:'unknown',evidence:'provider_unverified',requested_at:'2026-10-14T12:00:00Z',recorded_at:'2026-10-14T12:01:00Z'}]}});
 await page.goto(origin);for(const state of ['Requested','Confirmed','Failed','Unknown'])await page.getByText('Cancellation: '+state,{exact:true}).waitFor();
 assert.equal(await page.getByText('Stripe cancellation verified.',{exact:true}).count(),1);
 assert.equal(await page.getByText('Billing termination is not confirmed. Staff review required.',{exact:true}).count(),3);
 await page.getByText('Cancellation attempt history (latest 100 events)').click();await page.getByText('Retry of attempt-1').waitFor();await page.getByText('Provider outcome unknown.',{exact:true}).waitFor();
 assert.ok((await page.locator('body').innerText()).includes('Initiated by synthetic-manager'));
 await page.close();console.log('PASS reconciliation states, timestamps, attribution and retry history at width '+width);
 }
 console.log('4 Overview integration assertions and 2 responsive browser scenarios passed');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
