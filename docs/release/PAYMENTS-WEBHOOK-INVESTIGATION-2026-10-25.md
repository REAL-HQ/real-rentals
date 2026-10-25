# Payments webhook: production read-only investigation (2026-10-25)

Approved by the Owner as read-only. Every production statement ran inside `SET TRANSACTION READ ONLY`
through the Lovable database route. No events were replayed, no receipts were sent, and no Stripe
settings or records were changed. Only aggregates were read; no customer or payment details.

## Findings

| Check | Result |
|---|---|
| Hosted API (PostgREST) version | **14.5**, from `pg_stat_activity.application_name`. Local harnesses use **12.2.3**. |
| `payments` rows | **0**. Table statistics show historical test inserts and deletes, nothing live. |
| `payment_refunds` | 0 |
| `rentals` | 0 |
| Applications / rentals with a Stripe customer | 0 / 0 |
| Payment notifications (`notifications.kind='payment'`) | 0 |
| Payment- or Stripe-related `audit_log` actions (all time) | 0 |
| Receipt emails (`email_deliveries`) | None. No receipt workflow appears. |
| `financial_transaction_events` | 0 |

**Successful and failed charges:** none exist in production, so there is nothing to misclassify and
no missing receipts.

**Webhook processing errors:** the Stripe delivery log is not reachable from this environment.
The Owner can check Stripe → Developers → Webhooks → endpoint → failed deliveries. Even if events
were delivered, none could match a charge, because there are no charges or rentals.

## Is the #280 defect real in production? No.

The same replayed schema was served by the official PostgREST **12.2.3** and **14.5** binaries side
by side (throwaway database, synthetic rows):

| Release A write | 12.2.3 | 14.5 |
|---|---|---|
| Webhook notice claim `or(notified_status.is.null,notified_status.neq.paid)`, `select=id` | 400, 42703; nothing written | **200, row returned, claimed** |
| Webhook single-charge failure `or(stripe_payment_intent_id…)`, `select=id` | 400, 42703 | **200, marked failed** |
| Safe Autofill `or(color.is.null,color.eq.)`, `select=id` | 400, 42703 | **200, written** |
| Reminder claim `or(current_step…)`, `select=id` | 400, 42703 | **200, claimed** |
| Fixed variants (#280 `isdistinct`, #279 plain filters, #276 `select=id,current_step`) | 200, correct | 200, correct |

**Idempotency on 14.5** (Release A code and the #280 variant behave the same):

| Claim | Result |
|---|---|
| First claim | Returns the row |
| Replay | Returns `[]`, so no second email |
| Row previously notified 'failed' | Claimed for 'paid' |

**Event deduplication:** there is no event-id table. Deduplication is the atomic `notified_status`
claim, one notice per outcome. Status writes never un-pay (`neq('status','paid')` and
`neq('status','refunded')`).

## Conclusions

1. **No payments hotfix is needed.** The defect is a PostgREST 12.2.3 behaviour that production
   (14.5) does not have.
2. **Late receipts on Stripe retries:** there are no paid charges, so none can be sent. On 14.5 the
   existing claim already sends each receipt exactly once.
3. **Historical receipts:** none are owed. Nothing to backfill.
4. **What the fixes are now:**
   - #280 and #279 are optional, version-independent hardening.
   - The `733804dc` reminder change in A.1 is harmless and correct on both versions.
   - Their test fakes model 12.2.3, so local harness runs stay meaningful.
   - Earlier reports describing these as production defects are corrected here and in the PR
     descriptions.
5. **Harness gap:** local harnesses should move to PostgREST 14.5 to match production. The official
   binary is at `/tmp/pgrst14/postgrest`.
