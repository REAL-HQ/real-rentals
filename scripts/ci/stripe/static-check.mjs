import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const r = new URL('../../../', import.meta.url);
const read = p => fs.readFileSync(new URL(p,r),'utf8');
let checks=0; const check=(v,m)=>{assert.ok(v,m);checks++;console.log('PASS '+m)};
const source=read('src/lib/stripe-collections.server.ts');
const ast=ts.createSourceFile('server.ts',source,ts.ScriptTarget.Latest,true);
const calls=[];const visit=n=>{if(ts.isCallExpression(n)){const e=n.expression.getText(ast);if(e.startsWith('stripe.'))calls.push(e);}ts.forEachChild(n,visit)};visit(ast);
const allowed=['stripe.subscriptions.list','stripe.invoices.list','stripe.invoicePayments.list','stripe.charges.list','stripe.charges.retrieve','stripe.refunds.list','stripe.payouts.list'];
check(calls.length===7 && calls.every(c=>allowed.includes(c)), 'exact seven Stripe list/retrieve call sites');
for(const f of ['src/lib/stripe-collections.server.ts','src/lib/stripe-collections.functions.ts'])check(!/\.(insert|update|upsert|delete|rpc|create|capture|cancel|refund)\s*\(/.test(read(f)),f+' contains no mutation/RPC calls');
const fn=read('src/lib/stripe-collections.functions.ts');
check(fn.includes('.middleware([requireSupabaseAuth])') && fn.includes('.eq("user_id", context.userId)'), 'authenticated identity scopes current role lookup');
check(fn.indexOf('assertCollectionsAccess(roles.map')<fn.indexOf('await loadStripeCollections'), 'authorization before Stripe loader');
check(read('src/lib/stripe-collections.ts').includes('STRIPE_COLLECTIONS_ENABLED = false'), 'release flag disabled');
check(fn.includes('if (!STRIPE_COLLECTIONS_ENABLED) return'), 'server disabled gate');
const ui=read('src/components/admin/StripeCollections.tsx');
check(ui.includes('enabled: valid && STRIPE_COLLECTIONS_ENABLED') && ui.includes('if (!STRIPE_COLLECTIONS_ENABLED) return null'), 'disabled component neither auto-fetches nor renders refresh control');
const assets=new URL('.output/public/assets/',r);const files=fs.readdirSync(assets).filter(f=>f.endsWith('.js'));check(files.length>0,'actual client bundles exist');
const bundles=files.map(f=>fs.readFileSync(new URL(f,assets),'utf8')).join('\n');
for(const key of ['STRIPE_LIVE_API_KEY','STRIPE_SANDBOX_API_KEY','LOVABLE_API_KEY','X-Connection-Api-Key','connector-gateway.lovable.dev/stripe','loadStripeCollections'])check(!bundles.includes(key),'no server identifier in browser: '+key);
check(!/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}/.test(bundles),'no Stripe secret-key-shaped literal in browser');
console.log(JSON.stringify({passed:checks,failed:0,stripeCalls:calls}));

const results=JSON.parse(read('.stripe-ci-results.json'));
check(results.success===true && results.numTotalTests===67 && results.numPassedTests===67 && results.numFailedTests===0 && results.numPendingTests===0 && (results.numTodoTests??0)===0,'all 67 required tests executed without skip/todo');
for(const [name,count] of [['stripe-collections.test.ts',29],['stripe-collections-server.test.ts',30],['stripe-collections-auth.test.ts',8]]){
 const suites=results.testResults.filter(t=>t.name.endsWith('/'+name));
 check(suites.length===1 && suites[0].assertionResults.length===count && suites[0].assertionResults.every(t=>t.status==='passed'),name+' exact test coverage');
}
