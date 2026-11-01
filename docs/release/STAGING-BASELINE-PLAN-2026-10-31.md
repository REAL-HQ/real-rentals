# Production-schema baseline plan for staging (plan only, not executed), 2026-10-31

Owner rules (t27u): "Do not install all 122 repository migrations automatically." "The 10 missing policies and four vehicle columns must be documented, not silently introduced into a production-equivalent staging baseline." No staging SQL until separately approved.

Evidence: `staging-migration-reconciliation-2026-10-31.txt` (receipts vs files) and `staging-prod-migration-investigation-2026-10-31.txt` (object presence and definition hashes). Both came from read-only production queries.

## Categories

| Category | Items | Staging treatment |
|---|---|---|
| **A. Confirmed applied** (production receipt, text identical or re-stamped) | 104 receipts ↔ 104 files (48 exact, 56 Lovable re-stamped +1–4 s). 100 of them have byte-identical receipt text (4 differ, below). `20260925093000_fix_applicant_uploads` = receipt `20260925132035` (duplicate file) | Apply in production receipt order. Skip the duplicate `20260925093000` (its twin `20260925132035_f19ae6b6…` is applied). **4 receipted files whose repo text differs from the production receipt text** (`20260925160000_staff_tiers_invites_audit`, `20260925161000_vehicle_expenses`, `20260925170000_audit_log_revoke_default_grants`, `20261011180000_contact_status`): the receipt is authoritative. Apply the receipt text if retrieved under a separate approval, else flag and compare object hashes. |
| **B. Objects present without receipts** | 17 Sept 21–27 files (excluding the duplicate). Their tables 19/19, functions 12/12, triggers 14/14, indexes 38/38 and view 1/1 exist in production; 67/71 columns, 32/42 policies | Do **not** apply the files blindly. Recreate only the objects that exist in production, then compare per-object definition hashes against production; any hash mismatch is a discrepancy to resolve, not to overwrite. |
| **C. Objects missing from production** (declared by B-files, absent in prod) | 10 policies: "Staff manage automation workflows", "Staff manage automation steps", "Staff manage vehicle doc objects" (storage), "Staff manage toll charges", "Staff manage incidents", "Staff manage deposit deductions", "Scoped upload license photos" (storage), "Scoped upload profile screenshots" (storage), "Staff manage vehicle media", "Managers manage vehicle finance". 4 columns: `vehicles.lienholder`, `vehicles.purchase_date`, `vehicles.purchase_price`, `vehicles.ownership_type` | **Excluded** from the production-equivalent baseline. Documented here only. May have been dropped or renamed later; investigate separately. |
| **D. Unknown effects** | Receipt `20260628200526` (1 statement, md5 `af982277…`, creates no table/function/policy/trigger/index/view, matches no repo file) | Not applied. Effect unknown; the B-hash comparison after the build will reveal any resulting gap. Retrieving its statement text needs a separate approved read-only query. |
| **E. Drizzle** | 0000–0022 = 23 receipts (`5cfa7e88…`) | Apply 0000–0022 and write 23 receipts. 0023 is installed later as the guarded package with no receipt, as in production. |
| **F. Guarded packages** (production order) | 0031 v2 → S1 (RECONSTRUCTED, after review) → activation-insurance-setting → insurance-verification-authority → payments DELETE guard → payments write guard → 0023 | Adapted copies (system-id pin only, diff recorded), each with preflight and verify-after. |

## Proposed build order (needs approval; nothing executed)
1. `guard.sh --db-only` and `db-guard.sql` on every script (target `jcjsdribajbfracrmnkm` / `7702070854497379551`).
2. A (receipt order, minus duplicate) → B objects only, with hash comparison → E → F.
3. Verify: compare every B/F object hash against production's recorded hashes; S1 per RECONSTRUCTED README; 0031 md5 `d3387761…`; 0023 verify-after 7/7.
4. Report every mismatch. Nothing in C or D is introduced.

## Rollback
Delete project `jcjsdribajbfracrmnkm` (Owner-approved). Old staging and production are never touched.
