import { AppSelect } from "@/components/ui/app-select";
import { useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X } from "lucide-react";
import { FileUploader } from "@/components/FileUploader";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { VehicleCombobox, type VehicleComboboxVehicle } from "@/components/admin/VehicleCombobox";
import { formatVehicleLabel } from "@/lib/vehicle-label";
import { fileBulkReceipt } from "@/lib/receipt-bulk.functions";
import {
  BULK_RECEIPT_ACCEPT,
  BULK_RECEIPT_MAX_BYTES,
  BULK_RECEIPT_MAX_FILES,
  checkBulkFile,
  filenameText,
  guessReceiptKind,
  matchFileToVehicles,
  receiptStoragePath,
  type FileMatch,
  type MatchBasis,
} from "@/lib/receipt-bulk-match";

type Item = {
  key: string;
  file: File;
  match: FileMatch;
  kind: "receipt" | "invoice";
  state: "reading" | "ready" | "needs_car" | "uploading" | "done" | "error";
  error?: string;
};

async function readText(file: File): Promise<string> {
  let text = filenameText(file.name);
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    try {
      const { extractPdf } = await import("@/lib/agreement-extract");
      const ex = await extractPdf(new Uint8Array(await file.arrayBuffer()));
      text += "\n" + ex.pages.slice(0, 5).map((p) => p.lines.join("\n")).join("\n");
    } catch {
      /* scanned / unreadable: filename only */
    }
  }
  return text;
}

/** Drag-and-drop many receipts/invoices; auto-file by VIN, plate or car number; ask when unsure. */
export function BulkReceiptUpload({ vehicles }: { vehicles: VehicleComboboxVehicle[] }) {
  const file = useServerFn(fileBulkReceipt);
  const [items, setItems] = useState<Item[]>([]);
  const [picking, setPicking] = useState<Item | null>(null);
  const [picked, setPicked] = useState<(string | null)[]>([null]);

  const update = (key: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const upload = useCallback(
    async (it: Item, vehicleIds: string[], basis: MatchBasis | "manual") => {
      update(it.key, { state: "uploading" });
      try {
        const path = receiptStoragePath(vehicleIds[0], it.file.name);
        const up = await supabase.storage.from("receipts").upload(path, it.file, { contentType: it.file.type || undefined });
        if (up.error) throw up.error;
        await file({
          data: {
            storagePath: path,
            fileName: it.file.name.slice(0, 200),
            mimeType: it.file.type || null,
            sizeBytes: it.file.size,
            kind: it.kind,
            vehicleIds,
            matchBasis: basis,
          },
        });
        update(it.key, { state: "done" });
      } catch (e) {
        update(it.key, { state: "error", error: (e as Error).message || "Upload failed" });
      }
    },
    [file],
  );

  const add = async (files: File[]) => {
    const list = files.slice(0, BULK_RECEIPT_MAX_FILES);
    if (files.length > BULK_RECEIPT_MAX_FILES) toast.message(`Only the first ${BULK_RECEIPT_MAX_FILES} files were added.`);
    const fresh: Item[] = list.map((f) => ({
      key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      match: { kind: "unmatched" },
      kind: "receipt",
      state: "reading",
    }));
    setItems((xs) => [...fresh, ...xs]);
    for (const it of fresh) {
      const bad = checkBulkFile(it.file);
      if (bad) {
        update(it.key, { state: "error", error: bad });
        continue;
      }
      const text = await readText(it.file);
      const match = matchFileToVehicles(text, vehicles);
      const kind = guessReceiptKind(text);
      const next = { ...it, match, kind };
      if (match.kind === "auto") {
        update(it.key, { match, kind, state: "ready" });
        void upload(next, [match.vehicleId], match.basis);
      } else {
        update(it.key, { match, kind, state: "needs_car" });
      }
    }
  };

  const openPicker = (it: Item) => {
    setPicking(it);
    setPicked(it.match.kind === "ambiguous" ? [...it.match.candidates] : [null]);
  };

  const label = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? formatVehicleLabel(v) : id;
  };

  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <FileUploader
        variant="zone"
        multiple
        accept={BULK_RECEIPT_ACCEPT}
        maxBytes={BULK_RECEIPT_MAX_BYTES}
        maxFiles={BULK_RECEIPT_MAX_FILES}
        title="Drop Receipts Or Invoices Here"
        hint="PDF or photos, many at once. Matched to a car by VIN, plate or car number. Team-only; renters never see these."
        onFiles={(files) => void add(files)}
      />

      {items.length > 0 ? (
        <ul className="mt-3 divide-y divide-border text-sm">
          {items.map((it) => (
            <li key={it.key} className="py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{it.file.name}</div>
                <div className="text-xs text-muted-foreground">
                  {it.state === "reading" && "Reading…"}
                  {it.state === "uploading" && "Uploading…"}
                  {it.state === "ready" && it.match.kind === "auto" && `Matched by ${it.match.basis}: ${label(it.match.vehicleId)}`}
                  {it.state === "done" && (it.match.kind === "auto" ? `Filed to ${label(it.match.vehicleId)}` : "Filed")}
                  {it.state === "needs_car" && (it.match.kind === "ambiguous" ? `${it.match.candidates.length} possible cars — pick` : "No car found — pick")}
                  {it.state === "error" && <span className="text-real-red">{it.error}</span>}
                </div>
              </div>
              <AppSelect aria-label="Document Type" className="border rounded px-1 py-0.5 text-xs" value={it.kind} disabled={it.state === "done" || it.state === "uploading"}
                onChange={(e) => update(it.key, { kind: e.target.value as Item["kind"] })}>
                <option value="receipt">Receipt</option>
                <option value="invoice">Invoice</option>
              </AppSelect>
              {it.state === "needs_car" || it.state === "error" ? (
                <button type="button" className="text-xs text-real-red hover:underline" onClick={() => openPicker(it)}>Assign Car</button>
              ) : null}
              {it.state !== "uploading" ? (
                <button type="button" aria-label="Remove From List" onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}><X className="w-4 h-4" /></button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={!!picking} onOpenChange={(o) => !o && setPicking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {picking?.file.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {picking?.match.kind === "ambiguous" ? "This file matched more than one car. Keep the right ones." : "We could not read a car from this file."} You can assign it to one or more cars.
          </p>
          <div className="space-y-2">
            {picked.map((id, i) => (
              <div key={i} className="flex items-center gap-2">
                <VehicleCombobox vehicles={vehicles} value={id} allowNone={false} aria-label={`Car ${i + 1}`}
                  onChange={(v) => setPicked((p) => p.map((x, j) => (j === i ? v : x)))} className="flex-1" />
                {picked.length > 1 ? (
                  <button type="button" aria-label="Remove Car" onClick={() => setPicked((p) => p.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
                ) : null}
              </div>
            ))}
            <button type="button" className="text-xs text-real-red hover:underline" onClick={() => setPicked((p) => [...p, null])}>+ Add Another Car</button>
          </div>
          <DialogFooter>
            <button type="button" className="px-3 py-1 border rounded" onClick={() => setPicking(null)}>Cancel</button>
            <button type="button" className="px-3 py-1 rounded bg-foreground text-background disabled:opacity-50"
              disabled={!picked.some(Boolean)}
              onClick={() => {
                const ids = Array.from(new Set(picked.filter((x): x is string => !!x)));
                const it = picking!;
                setPicking(null);
                void upload(it, ids, "manual");
              }}>
              File To {Array.from(new Set(picked.filter(Boolean))).length || ""} car(s)
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
