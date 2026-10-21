import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getOwnerFinanceSnapshot } from "@/lib/owner-finance-snapshot.functions";
import { OWNER_FINANCE_SNAPSHOT_OFF } from "@/lib/owner-finance-snapshot-flag";
import {
  NOT_AVAILABLE,
  ownerFinanceSnapshotToCsv,
  type OwnerFinanceSnapshotReport,
  type SnapshotTile,
} from "@/lib/owner-finance-snapshot";
import { lastFullWeek } from "@/lib/rent-reconciliation";

/**
 * Read-only. Download CSV is built in the browser from the tiles on screen.
 * Mounted only while OWNER_FINANCE_SNAPSHOT_ENABLED is true.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: OwnerFinanceSnapshotReport };

export function OwnerFinanceSnapshotPanel() {
  const read = useServerFn(getOwnerFinanceSnapshot);
  const [weekStart, setWeekStart] = useState(() => lastFullWeek()?.from ?? "");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void read({ data: { weekStart: weekStart || undefined } })
      .then((result) => {
        if (!cancelled) setLoad({ kind: "ready", report: result.report });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setLoad({ kind: "unavailable", reason: message === OWNER_FINANCE_SNAPSHOT_OFF ? OWNER_FINANCE_SNAPSHOT_OFF : "Owner Weekly Finance Snapshot could not be loaded" });
      });
    return () => {
      cancelled = true;
    };
  }, [read, weekStart]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Owner Weekly Finance Snapshot</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One Monday through Sunday week in Eastern Time. Rent collected follows the collections total for charges paid in that week. Deposits are excluded from that total. A section that is not in this release, or that cannot be read, says {NOT_AVAILABLE}. This screen does not change a payment.
          </p>
        </div>
        {load.kind === "ready" && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      <label className="block text-sm font-medium">
        Week Starting
        <input
          type="date"
          value={weekStart}
          onChange={(event) => setWeekStart(event.target.value || lastFullWeek()?.from || "")}
          className="mt-1 block rounded-md border bg-background px-2 py-1 text-sm font-normal"
        />
      </label>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Owner Weekly Finance Snapshot…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: OwnerFinanceSnapshotReport }) {
  return (
    <div className="space-y-4">
      {report.from && report.through ? (
        <p className="text-sm text-muted-foreground">Week of {report.from} through {report.through}, Eastern Time.</p>
      ) : (
        <p className="text-sm text-muted-foreground">The week could not be read.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {report.tiles.map((tile) => (
          <Tile key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  );
}

function Tile({ tile }: { tile: SnapshotTile }) {
  const unavailable = tile.value === NOT_AVAILABLE;
  return (
    <section className="rounded-md border px-4 py-3">
      <h2 className="text-sm font-medium text-muted-foreground">{tile.label}</h2>
      <p className={unavailable ? "mt-1 text-sm text-muted-foreground" : "mt-1 text-2xl font-semibold"}>{tile.value}</p>
      {tile.tab && tile.screen ? (
        <Link to="/admin" search={{ tab: tile.tab }} className="mt-2 inline-block text-sm underline">
          {tile.screen}
        </Link>
      ) : null}
    </section>
  );
}

function downloadCsv(report: OwnerFinanceSnapshotReport) {
  const blob = new Blob([ownerFinanceSnapshotToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "owner-weekly-finance-snapshot.csv";
  link.click();
  URL.revokeObjectURL(url);
}
