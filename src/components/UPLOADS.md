# Uploads — the one standard

Existing uploads use `<FileUploader>` from `src/components/FileUploader.tsx`,
except the application wizard’s documented `MultiFileUpload` (same explicit
`useFileDrop` ownership and shared pure `inspectFiles` validation).
It handles drag-and-drop, Browse Files, click-to-browse, keyboard, phone camera,
validation (type, size, empty, count), previews, progress, Retry and Remove.
It never decides storage: the caller passes its existing pipeline.

## Modes (pick one)

```tsx
// 1. Queue: uploader runs the files through your existing upload code.
<FileUploader multiple accept="image/*,application/pdf" maxBytes={20 * 1048576}
  context={`${vehicle.unit_number} · Insurance Card`}
  upload={async (file, { onProgress }) => { await existingUpload(file); }}   // throw on failure → Retry
  onAllDone={refresh} />

// 2. Staged: a form that saves later shows previews + Remove; Save uploads.
<FileUploader value={files} onChange={setFiles} accept="image/*" />

// 3. Hand-off: caller already shows its own status list (e.g. Fleet Inbox).
<FileUploader multiple camera onFiles={(files) => enqueue(files)} />
```

Props: `accept`, `multiple`, `maxBytes`, `maxFiles`, `camera`, `autoStart`
(false = stage then "Upload N Files"), `variant` (`zone` | `inline` | `attach`),
`title`, `hint`, `context`, `label`, `disabled`, `busy`.
Helpers: `inspectFiles`, `validateFiles`, `useUploadQueue`, `FileList`.

Single-file fields reject an entire extra-file selection; batch count overflow
also rejects the selection instead of silently truncating. Existing staged and
queued files count toward capacity. Mixed type/size failures are reported while
valid batch members can proceed. Return the Promise from asynchronous `onFiles`
callbacks so both chooser and drop stay unavailable until processing settles.
`onAllDone` means every file succeeded; `onSettled` refreshes batch results even
when some files failed, without claiming success. Deferred notifications resume
once when a disabled queue is enabled again. Queue items bind their existing upload callback when selected: retries cannot
drift to a different parent destination. Disabling/unmounting stops subsequent
queued requests (already in-flight requests are not retroactively cancelled).

Each field owns its complete drop surface, including previews and errors.
Nested explicit fields stop propagation; non-file drags are untouched.
`FileDropBridge` only prevents accidental file-navigation outside a field; it
never discovers hidden inputs, assigns their files, or guesses a destination.

Context (vehicle, driver, category) comes from where the upload started — pass
it in; never ask the user to reselect it. Permissions stay with the caller's
server functions, RLS and storage policies.

## Guard

`scripts/file-upload-guard.test.mjs` fails on any raw `<input type="file">`
outside the allow-list. Exceptions must be listed there with a reason
(e.g. live camera/video capture).

## Inventory And Reproducible Regression

See `docs/audits/existing-upload-surfaces.json` for the pinned PR325 AST inventory
and `docs/audits/t180-existing-upload-drop.md` for destination/guard coverage,
synthetic-browser instructions, and deliberate verification limits.
