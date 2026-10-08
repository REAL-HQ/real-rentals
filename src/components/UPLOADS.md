# Uploads — the one standard

Every file upload uses `<FileUploader>` from `src/components/FileUploader.tsx`.
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
Helpers: `validateFiles`, `useUploadQueue`, `FileList`.

Context (vehicle, driver, category) comes from where the upload started — pass
it in; never ask the user to reselect it. Permissions stay with the caller's
server functions, RLS and storage policies.

## Guard

`scripts/file-upload-guard.test.mjs` fails on any raw `<input type="file">`
outside the allow-list. Exceptions must be listed there with a reason
(e.g. live camera/video capture).
