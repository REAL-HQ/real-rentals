import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Upload,
  Loader2,
  ArrowRight,
  Check,
  AlertTriangle,
  SkipForward,
  Download,
} from "lucide-react";
import {
  parseCsv,
  guessMapping,
  applyMapping,
  IMPORT_COLUMNS,
  type ImportRow,
} from "@/lib/vehicle-import";
import {
  previewVehicleImport,
  commitVehicleImport,
  type RowVerdict,
} from "@/lib/vehicle-import.functions";
import { MicroLabel, EmptyState } from "./ui";

// Bringing a fleet in from a spreadsheet.
//
// Three steps, and the middle one is the point: map the columns, see exactly
// what will happen to every row, then commit. An importer that starts writing
// and reports problems afterwards leaves somebody unpicking a half-imported
// fleet by hand.
//
// The preview is advice. The server re-checks every row at commit time against
// the fleet as it stands then, so two people importing at once cannot both
// win the same VIN.

const MAX_ROWS = 500;

export function ImportVehiclesStep({ onDone }: { onDone: () => void }) {
  const preview = useServerFn(previewVehicleImport);
  const commit = useServerFn(commitVehicleImport);
  const fileRef = useRef<HTMLInputElement>(null);

  const [headers, setHeaders] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Array<string | null>>([]);
  const [verdicts, setVerdicts] = useState<RowVerdict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; skipped: number; failed: number } | null>(
    null,
  );

  const rows: ImportRow[] = useMemo(() => applyMapping(body, mapping), [body, mapping]);
  const mapped = mapping.filter(Boolean).length;
  const hasRequired = ["year", "make", "model"].every((k) => mapping.includes(k));

  function read(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const grid = parseCsv(String(reader.result ?? ""));
      if (grid.length < 2) return toast.error("That file has no data rows.");
      const [head, ...rest] = grid;
      if (rest.length > MAX_ROWS) {
        toast.error(`That file has ${rest.length} rows. Import up to ${MAX_ROWS} at a time.`);
        return;
      }
      setHeaders(head);
      setBody(rest);
      setMapping(guessMapping(head));
      setVerdicts(null);
      setDone(null);
    };
    reader.onerror = () => toast.error("Could not read that file.");
    reader.readAsText(file);
  }

  async function check() {
    setBusy(true);
    try {
      const res = await preview({ data: { rows } });
      setVerdicts(res.rows);
    } catch (e: any) {
      toast.error(
        e?.message === "Forbidden" ? "Importing is Manager-only." : "Could not check that file.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    try {
      const res = await commit({ data: { rows } });
      setVerdicts(res.rows);
      setDone({ created: res.created, skipped: res.skipped, failed: res.failed });
      if (res.created) toast.success(`Added ${res.created} vehicle${res.created === 1 ? "" : "s"}`);
      else toast.message("Nothing was added — see the notes on each row.");
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Importing is Manager-only." : "The import failed.");
    } finally {
      setBusy(false);
    }
  }

  const summary = verdicts
    ? {
        create: verdicts.filter((v) => v.action === "create").length,
        skip: verdicts.filter((v) => v.action === "skip").length,
        error: verdicts.filter((v) => v.action === "error").length,
      }
    : null;

  // --------------------------------------------------------------- step 1
  if (!headers.length) {
    return (
      <div className="p-6 space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && read(e.target.files[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-xl border border-dashed border-border p-8 text-center hover:border-[#D03020] hover:bg-[rgba(208,48,32,0.02)] transition-colors"
        >
          <Upload className="w-6 h-6 mx-auto text-[#D03020]" strokeWidth={1.75} />
          <div className="mt-3 text-sm font-medium">Choose a CSV file</div>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto leading-relaxed">
            Any column order. You will map the columns and see exactly what will happen to each row
            before anything is created. Up to {MAX_ROWS} rows at a time.
          </p>
        </button>
        <button
          type="button"
          onClick={() => {
            const head = IMPORT_COLUMNS.map((c) => c.label).join(",");
            const blob = new Blob(
              [
                `${head}\nRR-001,1HGCM82633A004352,2021,Toyota,Camry,LE,Silver,sedan,ABC1234,FL,42150,350,available\n`,
              ],
              { type: "text/csv" },
            );
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "real-rentals-fleet-template.csv";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          className="inline-flex items-center gap-1.5 text-[12px] text-[#55555E] hover:text-[#D03020] transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> Download a template
        </button>
      </div>
    );
  }

  // --------------------------------------------------------------- step 3
  if (done) {
    return (
      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-[#EDEDF0] p-4">
          <div className="text-[15px] font-semibold text-[#111114]">
            {done.created} vehicle{done.created === 1 ? "" : "s"} added
          </div>
          <p className="text-[12px] text-[#55555E] mt-1">
            {done.skipped ? `${done.skipped} skipped. ` : ""}
            {done.failed ? `${done.failed} could not be created. ` : ""}
            {!done.skipped && !done.failed
              ? "Every row went in."
              : "Rows that did not go in are listed below."}
          </p>
        </div>
        {verdicts && (
          <VerdictTable
            rows={verdicts.filter((v) => v.action !== "create")}
            emptyLabel="Nothing was skipped."
          />
        )}
        <div className="flex justify-end">
          <button
            onClick={onDone}
            className="rounded-md bg-[#111114] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 transition-opacity"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- step 2
  return (
    <div className="p-6 space-y-4">
      <div>
        <MicroLabel className="mb-2">Match your columns</MicroLabel>
        <div className="rounded-xl border border-[#EDEDF0] divide-y divide-[#F4F4F6] max-h-64 overflow-y-auto">
          {headers.map((h, i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-2">
              <div className="w-[40%] min-w-0">
                <div className="text-[13px] text-[#111114] truncate">
                  {h || <em className="text-[#9A9AA3]">(no header)</em>}
                </div>
                <div className="text-[11px] text-[#9A9AA3] truncate">{body[0]?.[i] || "—"}</div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-[#C4C4CB] shrink-0" />
              <select
                value={mapping[i] ?? ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setMapping((prev) => prev.map((x, j) => (j === i ? v : v && x === v ? null : x)));
                  setVerdicts(null);
                }}
                className="flex-1 h-8 rounded-md border border-[#EDEDF0] bg-white px-2 text-[12px] outline-none focus:border-[#D03020]"
              >
                <option value="">Ignore this column</option>
                {IMPORT_COLUMNS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-[#9A9AA3] mt-1.5">
          {body.length} row{body.length === 1 ? "" : "s"} · {mapped} column{mapped === 1 ? "" : "s"}{" "}
          mapped
          {!hasRequired && " · year, make and model are required"}
        </div>
      </div>

      {verdicts && summary && (
        <div>
          <div className="flex flex-wrap gap-2 mb-2">
            <Chip tone="green" icon={Check}>
              {summary.create} to add
            </Chip>
            {!!summary.skip && (
              <Chip tone="grey" icon={SkipForward}>
                {summary.skip} skipped
              </Chip>
            )}
            {!!summary.error && (
              <Chip tone="red" icon={AlertTriangle}>
                {summary.error} with problems
              </Chip>
            )}
          </div>
          <VerdictTable rows={verdicts} emptyLabel="No rows." />
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => {
            setHeaders([]);
            setBody([]);
            setVerdicts(null);
          }}
          className="rounded-md px-3.5 py-2 text-[13px] text-[#55555E] hover:bg-[#F4F4F6] transition-colors"
        >
          Choose another file
        </button>
        <div className="flex-1" />
        {!verdicts ? (
          <button
            onClick={check}
            disabled={busy || !hasRequired}
            className="inline-flex items-center gap-2 rounded-md bg-[#111114] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Check this file
          </button>
        ) : (
          <button
            onClick={run}
            disabled={busy || !summary?.create}
            className="inline-flex items-center gap-2 rounded-md bg-[#D03020] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Add {summary?.create ?? 0} vehicle{summary?.create === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </div>
  );
}

function VerdictTable({ rows, emptyLabel }: { rows: RowVerdict[]; emptyLabel: string }) {
  if (!rows.length) {
    return <EmptyState title={emptyLabel} className="!py-6" />;
  }
  return (
    <div className="rounded-xl border border-[#EDEDF0] divide-y divide-[#F4F4F6] max-h-72 overflow-y-auto">
      {rows.map((r) => (
        <div key={r.line} className="flex items-start gap-3 px-3.5 py-2">
          <div className="w-9 shrink-0 text-[11px] text-[#C4C4CB] tabular-nums pt-0.5">
            {r.line}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-[#111114] truncate">{r.label}</div>
            {r.reason && <div className="text-[11px] text-[#55555E] mt-0.5">{r.reason}</div>}
            {r.warnings.map((w, i) => (
              <div key={i} className="text-[11px] text-[#C68A12] mt-0.5">
                {w}
              </div>
            ))}
          </div>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
            style={
              r.action === "create"
                ? { backgroundColor: "rgba(80,192,96,0.10)", color: "#3E9A4C" }
                : r.action === "skip"
                  ? { backgroundColor: "rgba(85,85,94,0.08)", color: "#55555E" }
                  : { backgroundColor: "rgba(208,48,32,0.10)", color: "#D03020" }
            }
          >
            {r.action === "create" ? "Add" : r.action === "skip" ? "Skip" : "Problem"}
          </span>
        </div>
      ))}
    </div>
  );
}

function Chip({
  children,
  tone,
  icon: Icon,
}: {
  children: React.ReactNode;
  tone: "green" | "grey" | "red";
  icon: any;
}) {
  const s =
    tone === "green"
      ? { backgroundColor: "rgba(80,192,96,0.10)", color: "#3E9A4C" }
      : tone === "red"
        ? { backgroundColor: "rgba(208,48,32,0.10)", color: "#D03020" }
        : { backgroundColor: "rgba(85,85,94,0.08)", color: "#55555E" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
      style={s}
    >
      <Icon className="w-3 h-3" /> {children}
    </span>
  );
}
