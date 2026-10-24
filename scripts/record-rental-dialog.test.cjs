// Stepped Record Rental dialog, rendered with local hook and server-function doubles (no
// browser, provider or database). Carries the recovery invariants previously probed in
// record-rental-validation-recovery.test.cjs for the single-form dialog, and adds the
// evidence steps: explanations, licence check, registration, void reason and billing review.
// Run: node scripts/record-rental-dialog.test.cjs
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert/strict');
const root = process.env.CANDIDATE_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript')), zod = require(path.join(root, 'node_modules/zod'));
let uuidCounter = 0;
const nextUuid = () => `20000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`;
function load(file, imports) {
  const exports = {};
  const src = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(src, { exports, require: n => { if (n in imports) return imports[n]; throw Error('unexpected import ' + n); },
    crypto: { randomUUID: nextUuid }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, Date, Number, JSON, Math, Promise, Error, console });
  return exports;
}
const contract = load('src/lib/record-rental-contract.ts', { zod });
const readiness = load('src/lib/record-rental-readiness.ts', { zod, './record-rental-contract': contract });

const ACTOR = '10000000-0000-4000-8000-000000000001', APP = '10000000-0000-4000-8000-000000000002';
const CAR = '10000000-0000-4000-8000-000000000004', OTHER = '10000000-0000-4000-8000-000000000005';
const AG = '10000000-0000-4000-8000-000000000006', HIST = '10000000-0000-4000-8000-000000000007', DOC = '10000000-0000-4000-8000-000000000008';
const SHA = 'a'.repeat(64);
const base = () => ({
  driver: { applicationId: APP, name: 'Synthetic Driver', portalLogin: true, archived: false },
  licence: { front: 'verified', back: 'verified', number: true, state: true, expiresOn: '2099-01-01' },
  agreements: [{ id: AG, vehicleId: CAR, status: 'signed', signedAt: '2026-10-01T15:00:00Z', voided: false, archived: true, signedTerms: true, sha256: SHA }],
  historicalInstalled: true, historical: null,
});
const BILLING = { environment: 'sandbox', customer: 'cus_Synthetic', subscription: 'sub_Synthetic', unitAmount: 35000, currency: 'usd', interval: 'week', nextDue: null, observedAt: '2026-10-24T12:00:00.000Z' };

function harness(facts, overrides = {}) {
  const states = [], refs = [], effects = [], calls = {};
  let si = 0, ri = 0, ei = 0;
  const react = {
    useState(v) { const i = si++; if (!(i in states)) states[i] = typeof v === 'function' ? v() : v; return [states[i], n => { states[i] = typeof n === 'function' ? n(states[i]) : n; }]; },
    useRef(v) { const i = ri++; return refs[i] ?? (refs[i] = { current: v }); },
    useEffect(f) { effects[ei++] = f; },
  };
  const jsx = (type, props) => ({ type, props });
  const handlers = {
    record: () => new Promise((_r, reject) => { handlers.lose = () => reject(new Error('synthetic lost response')); }),
    status: async () => JSON.parse(JSON.stringify(facts)), originals: async () => [],
    billing: async () => BILLING, licencePreview: async () => ({ fingerprint: 'f'.repeat(64), snapshot: { licence: 'synthetic' } }),
    licenceVerify: async () => ({ reviewId: nextUuid() }), archive: async () => ({}), registerPaper: async () => ({}),
    registerLegacy: async () => ({}), voidHistorical: async () => ({}), ...overrides,
  };
  const fn = name => ({ name });
  const Dialog = load('src/components/admin/RecordRentalDialog.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    '@tanstack/react-start': { useServerFn: f => arg => { (calls[f.name] ??= []).push(arg); return handlers[f.name](arg); } },
    '@/integrations/supabase/client': { supabase: { auth: { onAuthStateChange: cb => { cb('INITIAL_SESSION', { user: { id: ACTOR } }); return { data: { subscription: { unsubscribe() {} } } }; } } } },
    './modal': { ModalShell: 'shell', ModalHeader: 'header', ModalBody: 'body', ModalFooter: 'footer', ModalButton: 'button', ConfirmDialog: 'confirm', Field: 'field', FormGrid: 'grid', inputCls: '' },
    './PaperAgreements': { PaperAgreements: 'paper' },
    '@/lib/record-rental.functions': { recordExistingRentalV3: fn('record') },
    '@/lib/record-rental-contract': { ...contract, RECORD_RENTAL_CONTRACT_ENABLED: true },
    '@/lib/record-rental-recovery': { readRecovery: () => null, saveRecovery() {}, recoveryKey: () => '' },
    '@/lib/record-rental-evidence.functions': { recordRentalStatus: fn('status'), previewBillingLink: fn('billing'), previewPositiveLicense: fn('licencePreview'),
      verifyPositiveLicense: fn('licenceVerify'), archiveSignedAgreement: fn('archive'), registerHistoricalAgreement: fn('registerPaper'),
      registerLegacyEsignAgreement: fn('registerLegacy'), voidHistoricalAgreement: fn('voidHistorical') },
    '@/lib/paper-agreements.functions': { listPaperAgreementOriginals: fn('originals') },
    '@/lib/record-rental-readiness': readiness, zod,
  }).RecordRentalDialog;
  const props = { driver: { id: APP, full_name: 'Synthetic Driver' }, vehicles: [{ id: CAR, make: 'Synthetic', model: 'Car' }, { id: OTHER, make: 'Other', model: 'Car' }], onClose() {}, onRecorded() {} };
  // Local components (Facts, Blockers) are pure functions: expand them like React would.
  const flatten = n => !n ? [] : Array.isArray(n) ? n.flatMap(flatten) : typeof n !== 'object' ? []
    : typeof n.type === 'function' ? flatten(n.type(n.props)) : [n, ...flatten(n.props?.children)];
  const text = n => typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : '';
  const tick = () => new Promise(r => setImmediate(r));
  const h = {
    calls, handlers,
    render() { si = ri = ei = 0; return flatten(Dialog(props)); },
    async start() { h.render(); for (const e of effects) e(); h.render(); for (const e of effects.slice(1)) e(); await tick(); await tick(); return h.render(); },
    button(label) { return h.render().find(n => n.type === 'button' && text(n).startsWith(label)); },
    field(label) { const f = h.render().find(n => n.type === 'field' && n.props.label === label); return f && flatten(f.props.children).find(n => ['input', 'select', 'textarea'].includes(n.type)); },
    async set(label, value) { h.field(label).props.onChange({ target: { value } }); await tick(); },
    async click(label) { const b = h.button(label); assert.ok(b, 'button ' + label); await b.props.onClick(); await tick(); await tick(); },
    async go(title) { await h.click(title); },
    text() { return text(h.render()); },
    alert() { return h.render().find(n => n.props?.role === 'alert'); },
    save() { return h.render().filter(n => n.type === 'button').at(-1); },
  };
  return h;
}
// Values built inside the vm realm have foreign prototypes: compare their JSON.
const same = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
let passed = 0;
const pass = name => { console.log('PASS ' + name); passed++; };

(async () => {
  // 1. Explanations: every unmet requirement names itself and what to do, in Title Case.
  for (const [code, [title, detail]] of Object.entries(readiness.EXPLANATIONS)) {
    assert.match(title, /^([A-Z][\w'’-]*|eSign|&|A|As|For|Not|On|Or|In|The|To|Than|Of|Before|From)( ([A-Z][\w'’-]*|eSign|&|A|As|For|Not|On|Or|In|The|To|Than|Of|Before|From))*$/, code);
    assert.ok(detail.length > 20 && /[.]$/.test(detail), code);
  }
  pass('every blocker has a Title Case title and a plain-language next step');

  // 2. A driver with nothing ready: each step lists its own blockers, Save stays disabled.
  {
    const facts = base(); facts.driver.portalLogin = false; facts.licence.front = 'pending'; facts.agreements = [];
    const h = harness(facts); await h.start();
    assert.equal(h.calls.status.length, 1); same(h.calls.status[0], { data: { applicationId: APP } });
    assert.match(h.text(), /No Portal Login/); assert.match(h.text(), /Choose A Vehicle/);
    await h.go('Licence'); assert.match(h.text(), /Licence Images Not Verified/);
    await h.go('Signed Agreement'); assert.match(h.text(), /No Signed Agreement/); assert.equal(h.button('Register Signed Original').props.disabled, true);
    await h.go('Review'); await h.set('Type RECORD RENTAL To Confirm', 'RECORD RENTAL');
    assert.equal(h.save().props.disabled, true); await h.save().props.onClick(); assert.equal(h.calls.record, undefined);
    pass('unready driver: per-step explanations, registration locked, Save disabled and no RPC');
  }

  // 3. eSign path, with the recovery invariants of the former single-form probe.
  {
    const h = harness(base()); await h.start();
    await h.set('Vehicle', CAR);
    await h.go('Licence'); assert.match(h.text(), /Licence Check Not Confirmed/);
    assert.equal(h.button('Confirm Licence Verified').props.disabled, true);
    await h.click('Run Licence Check'); same(h.calls.licencePreview[0], { data: { applicationId: APP } });
    assert.match(h.text(), /synthetic/);
    await h.click('Confirm Licence Verified'); same(h.calls.licenceVerify[0], { data: { applicationId: APP, fingerprint: 'f'.repeat(64) } });
    assert.doesNotMatch(h.text(), /Licence Check Not Confirmed/);
    await h.go('Signed Agreement'); assert.match(h.text(), /eSign Verified/);
    await h.go('Rental Details');
    await h.set('Verified Pickup Time (With UTC Offset)', '2026-10-15'); assert.match(h.text(), /Start Time Needed/);
    await h.set('Verified Pickup Time (With UTC Offset)', '2026-10-15T10:00:00-04:00');
    await h.set('Weekly Rate', '350'); await h.set('Pickup Mileage', '1000'); await h.set('Reason For Recording', 'Synthetic reason');
    await h.go('Review'); await h.set('Type RECORD RENTAL To Confirm', 'RECORD RENTAL');
    // Partial correction: billing not yet checked, so Save stays disabled and sends nothing.
    assert.match(h.text(), /Billing Not Reviewed/); assert.equal(h.save().props.disabled, true);
    await h.save().props.onClick(); assert.equal(h.calls.record, undefined);
    await h.go('Billing'); await h.click('Check Existing Stripe Link');
    assert.match(h.text(), /sub_Synthetic/); assert.match(h.text(), /Billing Not Reviewed/);
    h.render().find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } });
    await h.go('Review'); assert.equal(h.alert(), undefined, 'no remaining error');
    const save = h.save(); assert.equal(save.props.disabled, false, 'valid draft enables Save');
    const inFlight = save.props.onClick();
    assert.equal(h.calls.record.length, 1);
    const sent = h.calls.record[0].data;
    assert.equal(sent.expectedActorId, ACTOR);
    same({ ...sent.request, operationId: undefined }, { applicationId: APP, vehicleId: CAR, startedAt: '2026-10-15T10:00:00-04:00',
      weeklyRate: 350, deposit: null, pickupMileage: 1000, subscriptionEvidenceId: null, reason: 'Synthetic reason' });
    assert.equal(h.save().props.disabled, true, 'in-flight locked'); await h.save().props.onClick(); assert.equal(h.calls.record.length, 1, 'no duplicate');
    h.handlers.lose(); await inFlight;
    assert.equal(h.render().some(n => n.type === 'fieldset'), false, 'unresolved payload cannot be edited');
    assert.match(h.text(), /Unresolved operation/);
    await h.save().props.onClick(); assert.equal(h.calls.record.length, 1, 'unresolved operation never sends a second RPC');
    pass('eSign path: licence preview+confirm by fingerprint, billing must be checked, exactly one RPC, actor bound, no client evidence, in-flight and unresolved locks');
  }

  // 4. Historical agreement: values come from the registration; void needs a reason.
  {
    const facts = base(); facts.agreements = [];
    facts.historical = { id: HIST, source: 'paper', legacyAgreementId: null, vehicleId: CAR, documentId: DOC, documentSha256: SHA, signedOn: '2026-08-01',
      legacySignedAt: null, rentalStart: '2026-08-02T12:00:00+00:00', weeklyCents: 30000, depositCents: null, termsSummary: 'Synthetic terms checked', registeredAt: '2026-10-20T12:00:00Z' };
    const h = harness(facts); await h.start();
    assert.equal(h.field('Vehicle').props.value, CAR); assert.equal(h.field('Vehicle').props.disabled, true);
    await h.go('Rental Details');
    assert.equal(h.field('Weekly Rate').props.value, '300.00'); assert.equal(h.field('Weekly Rate').props.disabled, true);
    assert.equal(h.field('Verified Pickup Time (With UTC Offset)').props.disabled, true);
    await h.go('Signed Agreement'); assert.match(h.text(), /Staff-Verified Paper Original/); assert.match(h.text(), /aaaaaaaaaaaa…/);
    await h.click('Void Historical Agreement');
    const confirm = () => h.render().find(n => n.type === 'confirm');
    await confirm().props.onConfirm(); await new Promise(r => setImmediate(r));
    assert.equal(h.calls.voidHistorical, undefined, 'no void without a reason'); assert.match(text(h.alert()), /Reason Needed/);
    const reason = h.render().find(n => n.type === 'textarea' && confirm()); reason.props.onChange({ target: { value: '  Wrong vehicle on paper  ' } });
    await confirm().props.onConfirm(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
    same(h.calls.voidHistorical[0], { data: { historicalAgreementId: HIST, reason: 'Wrong vehicle on paper' } });
    assert.equal(h.calls.status.length, 2, 'facts re-read after void');
    pass('historical: vehicle, start and rate fixed by the registration; void refuses without a reason and sends the trimmed reason');
  }

  // 5. Legacy eSign without signed terms: explained, and registration keeps its operation ids on failure.
  {
    const facts = base(); facts.agreements[0].signedTerms = false;
    let fail = true;
    const h = harness(facts, { registerLegacy: async () => { if (fail) { fail = false; throw new Error('Another change to this driver is in progress; try again.'); } return {}; } });
    await h.start(); await h.set('Vehicle', CAR);
    await h.go('Signed Agreement'); assert.match(h.text(), /Signed Before Rental Terms Existed/);
    assert.equal(h.button('Register As Legacy Agreement').props.disabled, true, 'needs start, rate and terms');
    await h.go('Rental Details'); await h.set('Verified Pickup Time (With UTC Offset)', '2026-10-02T09:00:00-04:00'); await h.set('Weekly Rate', '350');
    await h.go('Signed Agreement'); await h.set('Terms Checked', 'Weekly rate and deposit checked on the PDF');
    await h.click('Register As Legacy Agreement');
    assert.match(text(h.alert()), /try again/);
    await h.click('Register As Legacy Agreement');
    const [first, second] = h.calls.registerLegacy.map(c => c.data);
    same(first, second, 'retry repeats the same operation');
    assert.notEqual(first.operationId, first.paperOperationId);
    same({ agreementId: first.agreementId, rentalStart: first.rentalStart, weeklyRate: first.weeklyRate, deposit: first.deposit },
      { agreementId: AG, rentalStart: '2026-10-02T09:00:00-04:00', weeklyRate: 350, deposit: null });
    pass('legacy eSign: explained, registration needs confirmed values, a retry reuses the same operation ids');
  }

  // 6. Not installed: legacy route is explained as awaiting installation, no registration offered.
  {
    const facts = base(); facts.agreements[0].signedTerms = false; facts.historicalInstalled = false;
    const h = harness(facts); await h.start(); await h.set('Vehicle', CAR); await h.go('Signed Agreement');
    assert.match(h.text(), /Historical Agreements Not Installed/); assert.equal(h.button('Register'), undefined);
    pass('without the historical SQL, no registration control is offered');
  }

  // 6b. Registration is offered only where the database would accept it.
  {
    const facts = base(); facts.agreements[0] = { ...facts.agreements[0], status: 'sent', signedAt: null, archived: false, signedTerms: false, sha256: null };
    const h = harness(facts); await h.start(); await h.set('Vehicle', CAR); await h.go('Signed Agreement');
    assert.match(h.text(), /Agreement Not Signed/); assert.equal(h.button('Register'), undefined); assert.equal(h.field('Terms Checked'), undefined);
    const legacyFacts = base(); legacyFacts.agreements[0].signedTerms = false;
    const l = harness(legacyFacts); await l.start(); await l.set('Vehicle', CAR); await l.go('Signed Agreement');
    assert.ok(l.button('Register As Legacy Agreement')); assert.equal(l.button('Register Signed Original'), undefined); assert.equal(l.field('Paper Original'), undefined);
    pass('an open unsigned agreement offers no registration; a legacy agreement offers only the legacy route');
  }

  // 7. A billing read failure is shown, never treated as reviewed.
  {
    const h = harness(base(), { billing: async () => { throw new Error('This renter has more than one active Stripe subscription; resolve it in Stripe before recording'); } });
    await h.start(); await h.go('Billing'); await h.click('Check Existing Stripe Link');
    assert.match(h.text(), /Billing Link Unavailable/); assert.match(text(h.alert()), /more than one active Stripe subscription/);
    pass('billing failure blocks with an explanation');
  }

  // 8. Casing: no CSS text-transform in the dialog; labels and buttons are Title Case strings.
  const src = fs.readFileSync(path.join(root, 'src/components/admin/RecordRentalDialog.tsx'), 'utf8');
  assert.doesNotMatch(src, /uppercase|capitalize|text-transform|MicroLabel/);
  for (const m of src.matchAll(/label="([^"]+)"/g)) assert.match(m[1], /^[A-Z0-9(]/, m[1]);
  pass('no CSS text-transform; Title Case labels');
  console.log(`${passed} passed`);
})().catch(e => { console.error(e); process.exitCode = 1; });
function text(n) { return typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : ''; }
