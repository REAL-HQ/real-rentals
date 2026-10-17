import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listPaperAgreementOriginals } from "@/lib/paper-agreements.functions";
import { createRequestGate } from "@/lib/live-rental-release";
import { fmtDateTime } from "@/lib/date-format";

type Original = Awaited<ReturnType<typeof listPaperAgreementOriginals>>[number];

export function PaperAgreements({ applicationId }: { applicationId: string }) {
  const load = useServerFn(listPaperAgreementOriginals);
  const gate = useRef(createRequestGate());
  const [rows, setRows] = useState<Original[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const request = gate.current.begin();
    setRows(null); setFailed(false);
    load({ data: { applicationId } }).then((result) => {
      if (gate.current.isCurrent(request)) setRows(result);
    }).catch(() => { if (gate.current.isCurrent(request)) setFailed(true); });
    return () => { gate.current.invalidate(); };
  }, [applicationId, load]);
  return (
    <section className="border-t border-border pt-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4" />Paper</h4>
        <span title="Paper upload and linkage require approved provenance and retention safeguards.">
          <Button variant="outline" size="sm" disabled><Upload />Upload</Button>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">Upload and linkage are disabled pending approval.</p>
      {failed ? <p className="text-xs text-destructive">Paper agreements unavailable.</p>
        : rows === null ? <p className="text-xs text-muted-foreground">Loading…</p>
        : !rows.length ? <p className="text-xs text-muted-foreground">No classified paper agreements on file.</p>
        : <ul className="divide-y divide-border">{rows.map((row) => (
          <li key={row.id} className="py-2 text-xs space-y-1">
            <div className="font-medium break-words">{row.label ?? row.file_name ?? "Agreement"}</div>
            <div className="text-muted-foreground">{fmtDateTime(row.created_at)} · {row.is_current ? "Current" : "Historical"} · Linkage Unavailable</div>
            <div className="font-mono break-all text-muted-foreground">{row.content_sha256 ? `SHA-256 ${row.content_sha256}` : "Hash Not Recorded"}</div>
          </li>
        ))}</ul>}
    </section>
  );
}