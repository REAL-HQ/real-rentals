# Stripe Reconciliation — Local Completion Package

This package extends reviewed PR #22 HEAD d19970e926b8a666a8bb51c42cc3fe1b483bc9be. No hosted changes, live Stripe calls or financial data imports were performed. The earlier slice is retained below as historical evidence, superseded by this section.

## Implementation

Reuses rentals, payments, existing unique invoice/Payment Intent/subscription indexes, apply_payment_refund, the Stripe gateway, webhook signature verification, payment receipt delivery and Overview. Three new tables hold integration mappings, operation reservations and minimized event receipts; none is a competing financial ledger.

Owner/Manager server authorization and database checks protect explicit linking, review, replay and historical import. Matching never uses email. An external customer mismatch requires explicit customer confirmation and does not overwrite the existing rental customer. Historical imports require a fresh hash-matched preview and existing explicit subscription linkage. Unsupported, ambiguous and unmatched events remain review items, not revenue.

Creation reserves a stable operation and immutable provider parameters under a rental lock. Concurrent retries share idempotency keys. Unknown outcomes older than 23 hours require review rather than a fresh charge/subscription attempt. Cancellation failures persist and retain mappings; confirmed cancellation remains terminal. A new billing generation after cancellation requires a separately reviewed workflow.

Overview uses one stable database aggregate snapshot, not multiple client pages. Verified Stripe collections only enter rental revenue; deposits and refunds remain separate. Existing unverified paid records are excluded and counted for reconciliation. This is not a replacement for Manual Payments reporting. Refunds adjust the original collection period, not refund-date cash flow. Processing fees and payouts remain unavailable rather than estimated. Failed reporting displays unavailable, never fabricated zero revenue.

## Proposed database package and order

`0033_stripe_reconciliation.proposed.sql` SHA-256: `105c9b513134808c2dce724f2b9e52e7d1a40ac125d6db4b2ba2573bded8cff1`. It is outside migration autoload. Reservations 0022–0032 and all existing journals remain untouched. 0033 is proposed based on the inspected local/remote inventory, subject to final cross-developer reservation confirmation. No SQL has been applied to shared staging or production.

The migration requires the existing rentals/payments schema, unique provider identifiers, user_roles/private.is_manager and apply_payment_refund. It does not require eSign, Bookings or Manual Payments. Production installation requires full-schema compatibility verification, duplicate/precondition audit and a target-bound runner. Install SQL and the actual journal entry in one transaction, using actual execution-order timestamps, never filename order or backdating. On repeat execution verify recorded checksum and installed objects; skip only a verified match. Raw SQL intentionally refuses duplicate installation. Failure rolls back installation; do not remove existing financial history to retry.

Separate approval is required for installation and application deployment. Production security containment remains a separate release dependency; do not fold this package into the frozen security hotfix.

## Activation and recovery

Runtime pins: STRIPE_RECONCILIATION_ENABLED=true, STRIPE_RECONCILIATION_ENV=sandbox or live, STRIPE_RECONCILIATION_ACCOUNT=the reviewed account ID, STRIPE_REPORT_TIMEZONE=America/New_York (or approved business zone). Account and event livemode checks fail closed. No secrets are stored in this package. Obtain sandbox acceptance through the actual gateway before live activation.

Deploy schema before enabled application code. Do not activate the flag before dependencies are verified. On incident pause affected billing/webhook writes through an approved operational control, retain receipts and mappings, reconcile provider outcomes using their IDs/idempotency keys, then forward-repair and replay. Do not disable the flag as a routine rollback: it selects the legacy webhook path. Do not restore an old database snapshot or erase post-release payments.

Automatic ingestion deliberately holds multi-payment/credit/out-of-band/partial invoices and non-USD or non-weekly subscriptions for review. Payout/fee reconciliation is not implemented. Review UI lists the latest 100 exceptions; large backlogs need further pagination. Historical preview refuses more than 1,000 invoices rather than truncating silently. No claim of a completed production backfill is made.

## Verification and remaining gates

- 30 disposable PostgreSQL 17 tests: concurrent creation, uniqueness, duplicate/out-of-order events, monotonic refunds, durable cancellation, role denial, protected verified fields, snapshot consistency, installation failure and repeat-install rollback.
- 23 provider/handler tests with network disabled: provider normalization, explicit linkage, account mode, unsupported invoice handling, timezone boundaries, actual Manager authorization, concurrent idempotency and cancellation retry.
- 46 existing Stripe safety/regression tests passed; contract minimum-term tests passed.
- TypeScript and production build pass with original dependencies. Local Node 24.21.0/Vite 7.3.2/macOS arm64; this does not certify provider Linux reproducibility.
- Existing Driver Access baseline failure is unchanged; no related files edited.

Database tests use a focused production-shaped synthetic fixture and the existing refund function, not a complete production schema restore. Complete-schema compatibility, actual gateway contract, hosted browser acceptance and provider-signed sandbox delivery remain release gates. No live Stripe subscription, invoice, refund or identity data was retrieved. No hosted settings changed.

---

## Historical PR #22 slice (superseded implementation status)

# Stripe Reconciliation — Review Package

Base: verified GitHub main 1001d85c165b46b25fe33d57f0ec04b4eebb4148.
Local development only. No credentials, hosted data, Stripe calls, SQL execution, configuration changes or deployment.

## Safe implementation slice

Existing Stripe gateway/client, charge-before-collection system, refund RPC, payments records and Overview are reused. No new financial ledger. Cancellation retains the mapping on provider failure and returns a retry-required error; successful provider cancellation must precede a conditional local update. Card setup now requires authenticated explicit application ownership or existing Owner/Manager grants (Coordinators refused). Anonymous card links consequently require sign-in; a public ID is no longer authorization. Existing portal sign-in should be used, not a new token system. Embedded Checkout uses useServerFn to carry the authenticated session.

Weekly creation uses supported Prices product_data followed by a Subscription price ID. Original dependencies retained. The actual Lovable gateway needs test-mode acceptance; local tests cannot certify its runtime contract. Existing subscription-creation concurrency/crash safety remains gated on the atomic reservation proposal below. Do not enable new automated subscription onboarding on this slice alone.

Overview uses complete paginated payment reads with exact counts and duplicate/incomplete-page rejection. It remains under existing caller RLS. Pagination is not a database snapshot: concurrent same-count financial edits remain a reason to move the report into one reviewed aggregate RPC. No elevated reporting access added. Types rent/late_fee/other/toll/damage/fee count once; deposits separate. Net revenue subtracts recorded refunds from original payment dates, not refund-date cash flow. Payouts/fees are not inferred. Missing external reconciliation is explicitly disclosed rather than represented as zero unmatched records.

## Database-dependent work STOPPED for separate approval

No new migration number assigned; reservations through 0032 plus all other developer reservations must be checked before allocating one. Installed SQL and journals are untouched.

Proposed minimal changes (not executed):

1. On existing rentals add nullable `stripe_cancellation_state` constrained to `requested/failed/confirmed`, `stripe_cancellation_attempted_at timestamptz`, and a sanitized fixed-code `stripe_cancellation_error_code`. Preserve existing IDs and records. Failure state must survive page/session changes; current code only returns an explicit error and retains the mapping.
2. Add a partial unique constraint/index for non-null rental `stripe_subscription_id`, after a read-only duplicate audit. Never delete/reassign duplicates to make an index pass. Confirm existing unique invoice/Payment Intent constraints before adding anything.
3. Add minimal integration receipt/review storage, NOT a ledger: composite provider account/environment/event ID key, event type, external subscription/invoice/customer IDs, nullable rental FK, state (`unmatched/ambiguous/linked/failed/processed`), sanitized reason code, timestamps, reviewer ID. No raw webhook payload, card data, email or secrets. RLS denies public/Driver/Coordinator access; Owner/Manager review only. Service role writes only through an atomic ingestion/link function. Immutable review actions use the existing audit mechanism.
4. An atomic subscription-link operation locks the existing rental, checks customer AND subscription relationships against provider-verified values, rejects conflicting mappings, and records review/audit receipt in the same transaction. Client metadata, rental IDs, or email alone never authorize a link. Owner/Manager review resolves ambiguity. Transactional subscription-creation reservation + stable idempotency key is needed to prevent two concurrent creation attempts or a retry after a failed mapping write from creating a second subscription.
5. Retain invoice uniqueness and record its provider Payment Intent association for refund matching; do not create parallel payments. Use existing apply_payment_refund for refund application. Retryable failures must not be silently acknowledged as reconciled. Receipt+payment update commit atomically. Events arriving before linkage remain queued and replay idempotently after staff linking.
6. A single RLS-respecting reporting RPC should provide snapshot-consistent aggregates and reconciliation counts. It must not sum financial_transactions and payments as independent receipts. Refund-date cash movement requires event dates, distinct from original-period net revenue. No payout figure without verified payout data.

A complete SQL migration and isolated database tests follow separate schema-design approval. These are proposals, not claims that Phase 2 is implemented. No automatic linking/webhook write changes are activated in this commit.

## Historical dry run

`node --import tsx scripts/stripe-reconcile-dry-run.ts /secure/minimized-export.json`

Offline only; no credentials accepted, no API calls and no writes. Schema rejects extra fields. Input must certify complete pagination and consistent environment/account/window. Currency must be USD and all normalized amounts integer cents; an export producer must reject other currencies rather than convert them silently. Include all records needed for mappings/refunds, not only a recent payment window. No actual production export was requested or read.

Input arrays: subscriptions(id,customerId); rentals(id,subscriptionId,customerId); invoices(id,subscriptionId,paidCents,paymentIntentId); paymentIntents(id,receivedCents); refunds(paymentIntentId,amountCents) — successful refunds only; payments(id,invoiceId,rentalId,paymentIntentId,collectedCents,refundedCents); financialRecords(id,paymentId,collectedCents) — normalized posted cash receipt facts only, not accrual invoices, deposits or reversal pairs counted twice. `complete:true` required. Do not include names, emails, card numbers, credentials or payloads.

CLI prints counts by issue category only. Pure function returns IDs in memory for a future authorized staff review, never automatically links/imports. Duplicate source IDs and incomplete input stop the run. It flags unmatched/ambiguous subscriptions, customer mismatches, missing/duplicate invoices, mismatched amounts, missing PI links, refund differences and inconsistent existing ledger links. This is preparation, not a completed live reconciliation. No historical import exists.

## Activation gates and recovery

Review schema proposal, implement/test atomic persistence, and obtain separate installation approval. Then isolated Stripe sandbox acceptance through the real gateway; verify anonymous/wrong owner/Coordinator denial and Owner/Manager/own-app access, cancellation failure+retry, duplicate/reordered webhooks, external checkout ambiguity, invoice/refund reconciliation and multi-page reports. Only afterward request release approval. Existing Manual Payments/eSign/Bookings/security branches remain untouched.

On failure retain subscription mappings; never claim canceled without provider confirmation. Pause new linking/creation, retain event receipts for replay, and forward-repair. Do not roll back to unauthorized card setup or erase receipts/financial history. An external Stripe request and database update cannot be one transaction; recover using provider IDs and idempotency keys, never blindly create a replacement subscription.

## Verification results

- `node scripts/stripe-safety.test.mjs`: 46 synthetic checks passed, including actual card/cancellation/subscription handlers and signed/tampered/expired webhook envelopes.
- `node scripts/waitlist-security.test.mjs`: passed, including 20 actual-handler checks plus date/readiness suites.
- `node_modules/.bin/tsc --noEmit`: passed.
- `NODE_ENV=production npm run build`: passed; local Node 24.21.0, Vite 7.3.2, macOS arm64; existing installed dependencies reused, manifests/lockfiles unchanged. This is not a claim of Linux provider reproducibility. Build emits existing dependency directive/chunk warnings.
- Offline CLI synthetic export: correctly reported one unmatched subscription; no identifiers printed.
- `node scripts/grants.test.mjs`: source assertions passed; live database check skipped (no DB connection).
- `node scripts/driver-access.test.mjs`: one pre-existing account-adoption assertion fails identically in the unchanged main snapshot. The implementation and test involved were not edited. This remains on the existing identity-security track.

Review-ready local slice, not production-complete and not approved for publication. No live Stripe test-mode session or production reconciliation performed. No migration applied. External linking, persistent cancellation failure status, unmatched-payment review UI/counts and exact provider sandbox acceptance remain blocked/pending as described above.
