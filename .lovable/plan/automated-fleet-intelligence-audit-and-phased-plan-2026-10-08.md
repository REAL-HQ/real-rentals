# Automated Fleet Intelligence: Audit and Phased Plan

This is a read-only audit. Nothing has been changed, applied or published. Test A and Test B are untouched. The QA email file (the $590 "Auto Tag Red Fusion" bank transfer) was analysed when you opened it. It currently reads "Other / Needs Attention", with no vehicle and no expense.

## 1. Existing capabilities we will reuse
- **Intake:** one ingestion path for uploads and email, which feeds the same Fleet Inbox batches. Files are fingerprinted (SHA-256) and stored once in the private vault.
- **Analysis:** the shared document reader, plus an atomic "claim" so the same file is never analysed twice at once. Attempts are counted.
- **Matching:** exact VIN → unit number → plate → title number → registration number. Each must point to exactly one active vehicle. VIN, plate and unit number already have unique database indexes. Year, make and model never match a vehicle on their own.
- **Service transactions:** multi-page invoices and payment slips are grouped into one transaction. Apply creates one service record, at most one expense and at most one mileage reading. A database rule already prevents two service records for one transaction.
- **Apply:** proposals are re-built on the server from current data at Apply time. Mileage goes only into the append-only history.
- **Finance privacy:** Coordinators cannot read the raw import tables. Server code strips costs and amounts, and finance facts are Manager/Owner-only.
- **Existing tools:** the scheduled-job framework (token-protected routes + pg_cron, already used by automations, late fees, reminders and eSign archive retry), the immutable activity log, and the staff notifications table.

## 2. Gaps discovered
1. **Analysis only starts when someone opens the import.** Emailed files sit unanalysed until staff open them.
2. **No automatic retry, backoff or dead-letter.** A crash mid-analysis leaves a file stuck on "Analyzing" forever. The attempt count is never used.
3. **No "payment confirmation" document type.** Bank transfers fall into "Other". Nothing links a payment to an invoice, and nothing protects against double expenses across separate imports.
4. **No database-level duplicate protection** on document fingerprints, service-transaction groups or Fleet Inbox–sourced expenses. These are checked in code only.
5. **Matching** has no vehicle nickname, no assigned-driver evidence, no suggested matches with evidence, and no index on title or registration number.
6. **The vehicle picker loads the whole fleet** into the browser as a plain dropdown. That is fine at 9 cars, not at 1,000.
7. **Notifications** have no de-duplication key, no actions, and no aging. Duplicate alerts are possible.
8. **Audit and undo:** Apply (vehicle updates and service transactions) is not written to the activity log, and there is no controlled correction or reversal.
9. **No auto-file / auto-apply policy** exists. Everything is manual today, which is safe.

## 3. Proposed architecture
```text
Upload / Email ─► register file (dedupe by hash) ─► queue job (fleet_inbox_jobs)
                                                      │
          pg_cron every 1 min ─► /api/public/cron/fleet-inbox (token-protected)
                                                      │  lease lock, batch of N, concurrency cap
                                                      ▼
                         analyze ─► classify ─► group transaction ─► match + suggestions
                                                      │
                     Policy engine (Owner-configured, default = Review Only)
                ┌──────────────┬───────────────────┬────────────────────────┐
             Auto-File      Auto-Apply (off)    Review Required ─► one actionable notification
       (attach doc to an   (low-risk, approved     (reason, suggested vehicles,
        exact, unique       rules only; finance     Assign / Reprocess / Dismiss / Review)
        vehicle match)      always off)
                                                      │
                  Every automatic action ─► audit_log + correction record (reversible)
```
- **Job queue in the database:** state (queued / running / succeeded / retry_wait / dead), attempts, next_run_at with exponential backoff and jitter, and a lease expiry so stuck jobs are reclaimed. After the maximum attempts a job goes to dead-letter and shows in Fleet Inbox.
- **AI pause switch:** out-of-credit (402/403) errors and repeated rate limits pause the whole queue, the reason is shown to the Owner, and work resumes with at most one test file per run.
- **Payment confirmation** becomes a new document type. It is reconciled against open or applied transactions by amount, date, vendor and reference. A match attaches as evidence and never creates a second expense. An unmatched payment goes to Review.
- **Matching confidence:** exact identifiers score highest and are auto-eligible only when unique. Soft evidence (nickname, colour, current driver, prior documents) produces ranked suggestions only, never an automatic match.
- **Searchable vehicle picker:** server-side search across unit, VIN, plate, year/make/model, nickname and driver. Search waits for you to stop typing, results load page by page (25 at a time), and it works with the keyboard and remembers recent picks. Roles are enforced on the server.

## 4. Database changes required (for approval)
- New `fleet_inbox_jobs` table (queue) and `fleet_inbox_policy` (Owner-only settings, default all off), plus a pause-state row.
- New `vehicle_record_corrections` table (reversible log of automatic changes).
- `notifications`: add `dedupe_key` (unique while unresolved), `entity_type`/`entity_id`, `actions`, `resolved_at`/`resolved_by`, and staff audience.
- New `vehicles.nickname` (optional) with search indexes on title/registration/nickname.
- Unique partial indexes: documents on fingerprint (vehicle-docs, non-driver); service transactions on (batch, group key); expenses on source transaction.
- `payment_confirmation` document type and a payment-to-transaction link table.
- All new tables have access rules (RLS), grants and roles matching current Owner/Manager/Coordinator rules. Coordinators never see finance columns.

## 5. Security risks
- **Auto-apply could corrupt fleet or finance data.** Mitigation: policy off by default, finance never automatic, re-derive on the server, every change reversible and logged.
- **Notifications, search results or AI summaries could leak amounts or lender details to Coordinators.** Mitigation: server-side redaction for all of them, plus regression tests.
- **Public cron route.** Mitigation: the existing cron-token check, lease locking and bounded batches.
- **Email content is untrusted.** It stays as data only, and the AI is never given instructions from it.
- **Run-away AI cost.** Mitigation: per-run caps, concurrency limit and the pause switch.
- **Stricter duplicate rules could clash with existing rows.** Each will be checked against current data first, so nothing existing is modified.

## 6. Estimated effort (separately testable steps)
| Step | Scope | Size |
|---|---|---|
| A | Job queue, cron worker, retry/dead-letter, live status, audit of Apply | Medium |
| B | Payment confirmation type, reconciliation, expense dedupe indexes | Medium |
| C | Match suggestions with evidence, nickname, indexes | Small–Medium |
| D | Searchable vehicle picker (server-side, paged) | Small–Medium |
| E | Actionable de-duplicated notifications | Medium |
| F | Policy engine: Auto-File first; Auto-Apply framework (financial posting off) | Medium–Large |
| G | Validation suite incl. 1,000-vehicle simulation, concurrency, failure injection; cleanup | Medium |

## 7. Recommended sequence
A → B → C → D → E → F → G. Each step is verified in preview before the next one starts. No publishing, no Apply of Test A/B, and no changes to existing financial records without your approval. Step A is the first one that changes the database. I will start it only after you approve this plan.

## Open questions before Step A
- Should auto-analysis also run for staff uploads, or only for email? (Recommended: both.)
- Owner-only, or Owner and Manager, for changing automation rules? (Recommended: Owner-only.)
- When a file can't be matched, who should get the notification: all Managers, or Owner only?
