# Launch readiness audit (2026-10-26)

Read-only. Sources:
- **Live code:** `a3df8545`. Every flag below is read from its source.
- **Production database:** one `SET TRANSACTION READ ONLY` aggregate query, run 2026-10-26.
- **Open PRs:** #272 to #283.

Nothing was published, written, activated or changed in Stripe.

## Production facts

| Area | Value |
|---|---|
| Applications | 155 in total: 106 new, 9 partial, 7 reviewing, 2 approved, 21 closed, 6 declined, 4 duplicate |
| Driver screenings | 5, of which 2 are `insurance_verified` |
| Vehicles | 10: 4 available, 6 onboarding. **5 are Rental Ready** (`vehicle_rental_ready_missing` is empty) |
| Agreements | 1, which is signed and archived |
| Rentals | **0** |
| Payments | **0** |
| Stripe customers | 0 (earlier read) |

**Present:** `activate_rental_tx`, `end_rental_tx`, `esign_claim`, `esign_void`, `apply_payment_refund`, `vehicle_titles` and `outbound_messages`.

**Absent:**
- `activate_rental_checked_tx` (from PR 2);
- `paper_agreements` (Record Rental).

**Settings:** `app_settings` holds only *draft* entries for the two agreement library families (`agreement_library_draft:insurance_required` and `agreement_library_draft:no_insurance`).

**Scheduled jobs:**
- Hourly reminder job: repaired. The first run delivered one reminder under the 10-per-hour cap.
- Daily job 3 (ops reminders): still calls the missing function, so it is still broken.

## The ten features

| # | Feature | Status | What is live | What is still pending, and the exact dependency |
|---|---|---|---|---|
| 1 | Driver application and Save & Resume | **LIVE AND FUNCTIONAL** | `/apply` wizard with autosave and 14-day sessions. Decided applications are locked from resume (PR 1 and PR 4, live). | **A.2 (#283):** consent-footer overlap fix, now on Preview at `5d442808`. Needs the publish approval.<br>**Deployed but disabled:** Continue banner, staff resume link and phase-accurate resume (`APPLICATION_RESUME_ENABLED`), plus the progress panel (`APPLY_PROGRESS_ENABLED`). Each needs a flag build. Not needed for launch. |
| 2 | Application recovery links | **LIVE AND FUNCTIONAL** | Recovery by email, single use, 30 minutes, based on history. The hourly reminder job was repaired on 2026-10-25 at 23:29Z, and the first run at 00:15Z delivered. | **Atomic recovery:** Drizzle 0023 plus `APPLICATION_RESUME_ATOMIC_ENABLED`. Development complete, not deployed. Defer.<br>**Daily ops reminders (job 3):** development complete, not deployed. App on `fix/ops-reminders-safety` `a20f2cc7`, then SQL request `8a6a2166…1add`. |
| 3 | eSign agreement creation, sending and signing | **LIVE AND FUNCTIONAL** (template in use) | prepareAgreement fingerprint, Send, `/sign/$token`, claim and void functions. 1 real agreement signed. PR 3 date and initials fixes are live. | **A.2 (#277):** licence-expiry date and the permanent notice when Send is refused. On Preview, waiting for publish.<br>**Library families** (with insurance and without insurance): drafts only. Not sendable until the Owner approves a version. Not needed if launch uses the template in use.<br>**Deployed but disabled:** `AGREEMENT_PENDING_SIGNATURE_ENABLED` and `DRIVER_AGREEMENT_VIEW_ENABLED`. |
| 4 | Signed agreement storage and retrieval | **LIVE AND FUNCTIONAL** | PDF and SHA-256 archive (1 of 1 archived) with an hourly retry job. Signed records are permanent: no Delete, Replace or Needs New (PR 1 and #278). | **Immutable v1 archive:** `SIGNED_ARCHIVE_V1_ENABLED`, patch 03 and `signed-archive-protection-v1.sql`. Development complete, not deployed. Part of Record Rental. Defer. |
| 5 | Document upload and verification | **LIVE AND FUNCTIONAL** | Upload URLs, staff verification and the vault delete guard. 93 documents, 130 storage objects. | **Content hashing** (`DOCUMENT_CONTENT_SHA256_ENABLED`): needs M2 Window 1 and its backfill.<br>**Identity verification** (`IDENTITY_VERIFICATION_ENABLED`): deployed but disabled.<br>Two files are missing on a closed test record. This is not a blocker and is left unchanged. |
| 6 | Insurance verification and Owner exception setting | **DEVELOPMENT COMPLETE, NOT DEPLOYED** | Only a basic `driver_screenings.insurance_verified` toggle (2 drivers verified). Rental activation does **not** check it atomically. No Owner exception setting exists. | **PR 2 #275** (`feature/driver-activation-readiness` @ `418ec749`):<br>• insurance fails closed;<br>• only Managers and the Owner can verify or revoke;<br>• new setting "Allow Activation Without Insurance Verification";<br>• audited `activate_rental_checked_tx`.<br>Two SQL packages go with it: `activation-insurance-setting` `b80babcc…5505`, then `insurance-verification-authority` `eb7710d7…e950`, which must come **after** the PR 2 app is live. **Launch-critical.** |
| 7 | Driver approval and activation | **LIVE AND FUNCTIONAL** | Approval workflow (2 approved). "Active" status is set only by `activate_rental_tx`, Manager and above. | The insurance gate and the atomic `rental.activated` audit come with PR 2 (row 6).<br>Watch item 11 stays **PENDING**: no approval has happened in production since S1. Confirm it on the first real approval. |
| 8 | Record Rental and vehicle assignment | Standard new rental: **LIVE, never used**.<br>"Record Rental" for existing renters: **INCOMPLETE / BLOCKED** | New rental, vehicle assignment and activation through `activate_rental_tx`, using the 5 Rental Ready vehicles. **There are 0 rentals in production, so this path has never run live.** | **Record Rental**:<br>• M2 Windows 1 and 2;<br>• `paper-agreements-v1.sql` and `PAPER_RELEASE`;<br>• historical scripts 01 and 04;<br>• patch 03, which touches `esign.server.ts`;<br>• gateway scripts 01, 02 and 04 plus the gateway key secret;<br>• `RECORD_RENTAL_STRIPE_ENVIRONMENT=live`;<br>• Release B;<br>• an open business decision about renters with no signed original. |
| 9 | Rental closeout and vehicle swap | Closeout: **LIVE** (legacy path, never used).<br>Swap: **DEPLOYED BUT DISABLED** | End Rental through `end_rental_tx`. | **Swap:** `SWAP_ENABLED` is a hard `false`. Its SQL lives only in the M2 packet (`m2-packet/20.sql`, hosted step 26), so it is blocked behind M2.<br>**Safe End Rental:** `END_RENTAL_SAFE_V1_ENABLED` and `END_RENTAL_PRESERVES_APPLICATION_ENABLED` (needs `end-rental-preserves-application-v1.sql`). Deployed but disabled. Today's closeout closes the application as well, which is acceptable at launch. |
| 10 | Stripe payments, subscriptions and payment attribution | Charge, card setup and autopay: **LIVE code, not proven in production**.<br>Attribution and coordination: **DEVELOPMENT COMPLETE, NOT DEPLOYED** | Card-on-file setup Checkout, `chargeCardOnRental` (payment row written before collection), autopay with `subscriptions.create`, a webhook with signature verification, and refunds through `apply_payment_refund`. `STRIPE_COLLECTIONS_ENABLED=true` turns on a report only. **0 payments and 0 customers ever.** | **Live mode is unconfirmed.** The build picks live or sandbox from the prefix of `VITE_PAYMENTS_CLIENT_TOKEN`. The server needs `STRIPE_LIVE_API_KEY` and `PAYMENTS_LIVE_WEBHOOK_SECRET`. These cannot be checked read-only without exposing secrets, so the **Owner must confirm** them (see the approvals section).<br>**Development complete, not deployed:**<br>• subscription coordination (`RENTAL_SUBSCRIPTION_COORDINATION_ENABLED` and `subscription-coordination-v1.sql`);<br>• Record Rental payment attribution (gateway);<br>• `MANUAL_PAYMENTS_LIVE`.<br>**#280:** optional. Not needed on PostgREST 14.5. |

## Minimum viable launch set

New drivers apply on `/apply`, can save and recover their application, and upload documents. Staff:
1. verify the documents;
2. verify insurance (fail-closed, Manager or Owner);
3. approve the driver;
4. send the agreement through eSign using the template in use;
5. the driver signs, and the signed copy is archived and permanent;
6. staff assign one of the 5 Rental Ready vehicles and activate the rental with `activate_rental_tx` / `activate_rental_checked_tx`;
7. the driver's card is saved through Stripe setup, and staff start autopay or charge the card;
8. staff end the rental with End Rental.

This is features 1–7, plus standard new rentals from feature 8, closeout from feature 9, and the core charge, card-setup and autopay paths from feature 10.

## Shortest safe activation sequence

| Stage | Steps | Production operations | Rollback |
|---|---|---|---|
| **1. Release A.2** | Publish `5d442808` (frozen on Preview; GO packet `A2-GO-NO-GO-2026-10-26.md`). The Owner checks the live `data-commit-sha`. | 1 publish | Republish `a3df8545` |
| **2. PR 2 (insurance)** | **Before production:** I rebuild PR 2 on A.2 (trial merge is clean) and re-run every test, including the S1, 0031 and M2 compatibility checks. Then draft the review PR.<br>**In production:**<br>(a) fast-forward Preview to that commit;<br>(b) install `activation-insurance-setting`;<br>(c) publish;<br>(d) the Owner checks the live SHA;<br>(e) install `insurance-verification-authority` within about 10 minutes;<br>(f) the Owner leaves the exception setting **off**. | Preview update, 2 guarded SQL requests, 1 publish | Republish `5d442808`. Each package ships with its own rollback. |
| **3. Payments go-live check** | No code change. The Owner confirms the Stripe live configuration. The first real rental and first real charge are watched with read-only checks. No test charges are made. | None, or Owner settings only | — |
| *Optional: 4. Ops reminders* | App guard on `a20f2cc7` (publish), then the job 3 SQL. This can go right after launch. | 1 publish, 1 SQL | Republish the previous build; SQL rollback included |

**Remaining deployment stages to launch: 2** (A.2, then PR 2), plus the Owner's Stripe check. This means **2 publishes and 2 SQL installs**. With ops reminders, it is 3 stages.

## PRs and migrations

**Required for launch:**
- **#283** (A.2: #277, #279 and the consent footer).
- **#275** (PR 2) with `proposed/activation-insurance-setting` and `proposed/insurance-verification-authority`.

No Drizzle or Supabase ledger migration is needed. Security 0031, S1 and M2 stay as they are.

**Not required:**
- #276, #281 and #282 are reference only.
- #280 is optional.
- #272, #273, #274 and #278 are already live, so they can be closed as delivered.

## Deferred until after launch

In rough order of value:

1. **Ops reminders** (job 3 plus the app guard). This includes the agreement-signing nudge.
2. **Resume UI flags** (`APPLICATION_RESUME_ENABLED` and `APPLY_PROGRESS_ENABLED`) and Drizzle 0023 atomic recovery.
3. **Agreement library families.** Owner approval of the with-insurance and without-insurance versions. These are needed only if the Owner exception is used.
4. **M2 Windows 1 and 2**, then Release B. These unlock document hashing, vehicle swap and the immutable archive.
5. **Record Rental:** historical and paper agreements, gateway, payment attribution, subscription coordination, and the open business decision.
6. Safe End Rental, identity verification, portal flags, manual payments and #280.

## Owner approvals needed

1. **A.2 publish:** "I approve publishing Lovable project `8cf1f99e` once at commit `5d442808730c29a8cb3021eff14c2a7316b90434` (Release A.2), rollback target `a3df8545`." Then a screenshot of the live SHA.
2. **PR 2 build review:** approve the rebuilt PR 2 commit (I will post its SHA) and the Preview fast-forward to it.
3. **PR 2 production, as one or separate approvals:**
   - install `activation-insurance-setting` (request `b80babcc…5505`);
   - publish the PR 2 commit, rollback `5d442808`, then a live-SHA screenshot;
   - install `insurance-verification-authority` (request `eb7710d7…e950`).
4. **Insurance exception policy:** confirm that "Allow Activation Without Insurance Verification" stays **off** at launch. This is recommended. Turning it on would also need an approved no-insurance agreement version.
5. **Stripe live confirmation.** Owner only. Confirm presence only and never share values:
   - the published build's publishable key starts with `pk_live_`;
   - `STRIPE_LIVE_API_KEY` and `PAYMENTS_LIVE_WEBHOOK_SECRET` are set in Lovable secrets;
   - the Stripe live webhook points at `https://drivereal.com/api/public/payments/webhook`.

   Also approve that the first live charge happens only as real business, with no test charges.
6. *(Optional)* Ops reminders: app publish, then the job 3 SQL request `8a6a2166…1add`.

## Launch risks to watch (not blockers)

- **Rentals, payments and Stripe customers are all 0 in production.** Activation, charging, autopay, the webhook and End Rental have passed tests but have **never run live**. The first real rental should be attended, with a read-only watch afterwards.
- **Watch item 11** (approval) stays open until the first natural approval.
