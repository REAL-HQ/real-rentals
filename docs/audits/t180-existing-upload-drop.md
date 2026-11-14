# t180 — Existing Upload Fields: Explicit File Drop

## Scope And Inventory

Stacked on PR325, baseline `7f3d2ce865d985e9b581aa9e01de28dc55506151`.
No server, storage policy, migration, database or new upload destination changes.
No production upload, record creation, message, activation, merge or deployment.

The pinned TypeScript AST inventory corrects the initial text-search estimate:
**22 FileUploader source sites / 21 files**, plus **one direct wizard
MultiFileUpload**, totaling **23 field definitions / 22 owner files**.
There are **four actual raw JSX file inputs / two owner files** (normal chooser
and camera in each implementation), not six/three. Comments and selector strings
caused the earlier overcount. FileDropBridge has zero file inputs. UploadDropzone
is one shared definition, called by QuickAddVehicle and VehicleService; category
and angle loops can render multiple runtime fields from one definition. Expanding
that one wrapper definition into its two caller sites gives **24 leaf source
entrypoints / 23 owner files**, including the direct wizard; this is still not a
runtime instance count. The shared-definition and expanded-leaf counts must not
be confused.

`existing-upload-surfaces.json` captures every original callback, accept, count,
size, context and input prop from the exact PR325 baseline, not this changed tree.
The inventory regression checks all FileUploader callsites against that snapshot.
Existing metadata/confirmation paths remain with their owners.

## Existing Destinations And Guards (Source Audit, Not Live Uploads)

| Existing field | Existing path / limits / permission boundary |
| --- | --- |
| ApplicantDocuments | Application/category-bound driver-docs signed upload; 15 MB; existing working guard. |
| BulkReceiptUpload | Manager private receipts and team-only matching; 20 MB / 50; async read handoff now awaited. |
| DocumentBatchUpload | Staged driver-docs category queue; existing running guard. |
| DocumentVault (two fields) | driver-docs; existing admin/category and signed-agreement locks; existing 15 MB handler cap also shown/enforced at selection. |
| ExpensesPanel | Existing receipts; 10 MB; saving guard. |
| FleetInboxPanel | Staging, then explicit Upload Files to vehicle-docs/import batch; no vehicle apply on drop; existing staff/kind restrictions. |
| ImportVehiclesStep | Local CSV parse/preview only; 500-row existing cap; later explicit commit unchanged; FileReader now returns its processing Promise. |
| InspectionsPanel | condition-media; operational inspection/role binding; existing angle/phase; image/mp4/quicktime, 50 MB. |
| ManualPaymentsWorkspace | Existing practice-mode staged receipt; explicitly not uploaded. |
| OwnerExpenseEntryPanel | Existing owner receipts; 10 MB; saving guard. |
| PaperAgreements | Staged signed PDF; 20 MB; existing actor/release/operation guards and later explicit registration. |
| ReturnCloseoutFields | condition-media; existing return/rental ownership and angle; 50 MB. |
| TemplateUploadDialog | Owner-only private rental-agreements/template-uploads; PDF/docx 10 MB; existing busy state now disables both entry paths. |
| TitleScanStep | Existing read-only extraction, not vehicle save; JPEG/PNG/WebP/PDF, 5 MB. |
| VehicleDocUploadDialog | Existing batch read/private vehicle-docs or existing direct-save callback; 20 MB; batch only in read mode. |
| VehiclePhotos | vehicle-photos and existing registration; existing canEdit gate; JPEG/PNG/WebP/AVIF/GIF 15 MB; no publish. |
| VerificationRecording | Owner-only driver-docs recording category; existing audio/video 50 MB. |
| modal UploadDropzone | Existing deferred photo/receipt values; QuickAddVehicle saving and VehicleService busy guards now forwarded. |
| Portal DocumentUpdateCard | Own editable driver-docs category, existing signed upload/confirm; 15 MB. |
| Site DocumentCapture | Existing resume-token uploadApplicantFile kind; original generous 60 MB raw ceiling and post-optimization validation retained. |
| Partners | Existing staged images, six total; later explicit submission to owner-vehicle-photos; submitting now disables selection. |
| Direct wizard MultiFileUpload | Same resume-token trip_history pipeline to profile-screenshots; ten total or exactly one replacement; existing optimization/post-opt MIME/size checks retained. |

The server functions keep existing owner/manager/coordinator/applicant/renter
checks; client disabled flags do not replace server authorization. No tighter raw
wizard-image limit was invented: existing optimization and signed-upload checks
still determine post-optimization eligibility. Per-file callback references bind
queued destinations, including retries and permission-paused continuations.

## Behavior

- Genuine File drops and native chooser/camera converge on the same validator
  and caller pipeline. Disabled/busy inputs cannot accept new files.
- Single-only and count-overflow selections reject the whole selection with
  visible errors; no silent first-file selection/truncation. Invalid members of
  mixed type/size batches are explained while valid members may proceed.
- Staged/queue capacity includes earlier files. Duplicate files are not added
  twice. Failed queue entries can be retried/reselected without consuming an
  extra slot. Async handoffs prevent reentrant selection.
- Explicit nested surface ownership prevents duplicate delivery/highlights;
  movement between descendants does not flicker; non-file drags are untouched.
- The root bridge only prevents accidental browser file-navigation outside a
  field. It cannot discover inputs or infer/bypass a destination.
- Accessible native buttons and Enter/Space chooser support remain. Active hints
  name the action; persistent field errors accompany existing toasts. Processing
  handoffs do not falsely say an upload occurred. Existing photo/inspection batch
  refresh uses a distinct settled callback, including failures, while success-only
  callbacks never claim a failed upload succeeded. Deferred completion/refresh is
  delivered once on re-enable, including a last file finished while disabled.
- Disabling/unmounting stops subsequent queued requests; an already in-flight
  request is not retroactively cancelled. Wizard replacement retains the original
  until successful upload and explicitly names an unuploaded paused remainder.

## Reproduction And Verification Limits

```
PG_BIN=/tmp/pgbin npm test
npx tsc --noEmit
npm run build
node scripts/upload-drop-browser.test.mjs
```

The new pure/inventory regression has **42 checks**. The browser regression has
**54 checks**, using actual FileUploader/useFileDrop/FileDropBridge and the
production MultiFileUpload AST body (not a rewritten facsimile). Only upload and
precheck transports are synthetic. Genuine DataTransfer File drag events,
native Playwright filechooser events, keyboard and phone camera chooser paths
are exercised. HTTP is blocked and zero HTTP requests are asserted.

Includes count/type/empty/size/duplicates, staged totals, disabled/busy/reentrancy,
errors and retries, nested ownership/no flicker, non-file/outside drops, paused
queues, captured destination binding, unmount safety, wizard total-ten/replacement
failure/retry/permission transitions, and 390px native-100%-zoom overflow.

Generated local-only candidate: `.upload-drop-browser/candidate.html`.
Screenshots: `admin-drop-1280.png` and `wizard-drop-390.png` in that directory.
Logs: `.upload-drop-audit/`. These generated directories are ignored by Git.

This verifies the shared implementations and inventories every existing owner;
it does **not** claim individual live-page end-to-end browser verification of all
23 field definitions, human visual approval, real storage uploads, or new server
authorization proof. Parent human candidate review remains pending. Existing full
PG authorization regressions run unchanged. No production data is needed.

PR320–325 are unchanged by this child branch. PR322 migration remains prepared,
not applied. Earlier inline-Active readfailure/blocked paths remain automated-only
because parent browser file access was denied; this work neither retries that
access nor claims visual verification of those paths.
