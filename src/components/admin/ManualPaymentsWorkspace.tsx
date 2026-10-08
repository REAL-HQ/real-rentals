import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, inputCls } from "./modal";
import { FileUploader } from "@/components/FileUploader";
import { fmtDate, fmtDateTime } from "@/lib/date-format";
import type { Payment, Application } from "./types";
import {
  MANUAL_PAYMENTS_LIVE, PENDING_HOURS, METHOD_LABEL, STATUS_LABEL, addHours, reserved, sweepExpired,
  validateRecord, validateVerify, validateReason, validateExtend, canRecord, canDecide,
  type Collection, type Method, type Role, type Charge,
} from "@/lib/manual-payments";

// Gated preview. While MANUAL_PAYMENTS_LIVE is false every action runs in
// Practice Mode: in-memory only, never saved, never touches Stripe, charges,
// rentals or the ledger. Real charges are read for display only.

const ACTORS: Record<Role, string> = { owner: "Owner", manager: "Manager A", coordinator: "Coordinator", driver: "Driver" };
type Dialog = null | { kind: "record"; chargeId: string } | { kind: "verify" | "reject" | "reverse" | "extend"; id: string };

export function ManualPaymentsWorkspace({ payments, driverMap, onClose }: {
  payments: Payment[]; driverMap: Record<string, Application>; onClose: () => void;
}) {
  const [role, setRole] = useState<Role>("manager");
  const [actor, setActor] = useState("Manager A");
  const [colls, setColls] = useState<Collection[]>([]);
  const [verified, setVerified] = useState<Record<string, number>>({}); // practice-only balance reductions
  const [dlg, setDlg] = useState<Dialog>(null);
  const [tab, setTab] = useState<"open" | "pending" | "history">("open");
  const now = new Date();

  useEffect(() => { const t = setInterval(() => setColls((c) => sweepExpired(c, new Date())), 30_000); return () => clearInterval(t); }, []);

  const charges: Charge[] = useMemo(() => payments
    .filter((p) => !["paid", "refunded", "waived", "void"].includes(String(p.status)))
    .map((p) => {
      const open = p.balance_due == null ? Number(p.amount || 0) : Number(p.balance_due);
      return { id: p.id, amount: Number(p.amount || 0), balance: Math.max(0, open - (verified[p.id] ?? 0)), status: String(p.status), stripeInProgress: String(p.status) === "pending" };
    }), [payments, verified]);
  const chargeMap = Object.fromEntries(charges.map((c) => [c.id, c]));
  const label = (id: string) => { const p = payments.find((x) => x.id === id); const d = p && driverMap[(p as any).driver_id]; return `${d?.full_name ?? "Driver"} · ${String((p as any)?.type ?? "charge").replace(/_/g, " ")} · due ${fmtDate((p as any)?.due_date)}`; };

  const pending = colls.filter((c) => c.status === "pending");
  const switchRole = (r: Role) => { setRole(r); setActor(ACTORS[r]); };
  const patch = (id: string, f: (c: Collection) => Collection) => setColls((cs) => cs.map((c) => (c.id === id ? f(c) : c)));
  const log = (c: Collection, action: string, reason?: string) => [...c.audit, { at: new Date().toISOString(), actor, action, reason }];

  return (
    <ModalShell onClose={onClose} size="workspace" label="Manual Payments">
      <ModalHeader title="Manual Payments" subtitle="Record, verify, reject and reverse payments received outside card checkout." onClose={onClose} />
      <ModalBody>
        <div role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <b>{MANUAL_PAYMENTS_LIVE ? "Live" : "Practice Mode — Nothing Is Saved."}</b>{" "}
          Manual payments are not active yet; they wait on the database foundation approval. Actions here stay on this screen,
          never change real charges, never charge a card and disappear when you close this window.
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Practice As:</span>
          {(["owner", "manager", "coordinator", "driver"] as Role[]).map((r) => (
            <button key={r} onClick={() => switchRole(r)} className={`rounded-md border px-3 py-1 ${role === r ? "border-foreground bg-foreground text-background" : "border-border bg-card"}`}>{ACTORS[r]}</button>
          ))}
          {role === "manager" && (
            <button onClick={() => setActor(actor === "Manager A" ? "Manager B" : "Manager A")} className="rounded-md border border-border px-3 py-1">Switch To {actor === "Manager A" ? "Manager B" : "Manager A"}</button>
          )}
          <span className="ml-auto text-muted-foreground">Acting: <b className="text-foreground">{actor}</b></span>
        </div>
        <div className="mb-3 flex gap-2 text-sm">
          {([["open", `Open Charges (${charges.length})`], ["pending", `Pending Verification (${pending.length})`], ["history", `Payment History (${colls.length})`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-foreground text-background" : "border border-border"}`}>{l}</button>
          ))}
        </div>

        {tab === "open" && (
          <Table head={["Charge", "Open Balance", "Pending (Reserved)", "Available", ""]} empty="No open charges.">
            {charges.map((c) => { const r = reserved(c.id, colls, now); return (
              <tr key={c.id} className="border-t border-border">
                <td className="p-2">{label(c.id)}</td><td className="p-2">${c.balance.toFixed(2)}</td>
                <td className="p-2">${r.toFixed(2)}</td><td className="p-2">${Math.max(0, c.balance - r).toFixed(2)}</td>
                <td className="p-2 text-right"><button disabled={!canRecord(role)} title={canRecord(role) ? "" : "Not allowed for this role"} onClick={() => setDlg({ kind: "record", chargeId: c.id })} className="rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-40">Record Payment</button></td>
              </tr>); })}
          </Table>
        )}
        {(tab === "pending" || tab === "history") && (
          <Table head={["Charge", "Method", "Amount", "Received", "Status", "Deadline", "Recorded By", ""]} empty={tab === "pending" ? "Nothing waiting for verification." : "No payments recorded yet."}>
            {(tab === "pending" ? pending : colls).map((c) => (
              <tr key={c.id} className="border-t border-border align-top">
                <td className="p-2">{label(c.chargeId)}<History c={c} /></td>
                <td className="p-2">{METHOD_LABEL[c.method]}{c.reference ? ` · ${c.reference}` : ""}{c.hasReceipt ? " · Receipt" : ""}</td>
                <td className="p-2">${c.amount.toFixed(2)}</td><td className="p-2">{fmtDate(c.receivedOn)}</td>
                <td className="p-2">{STATUS_LABEL[c.status]}</td>
                <td className="p-2">{c.status === "pending" ? fmtDateTime(c.expiresAt) : "—"}</td>
                <td className="p-2">{c.recordedBy}</td>
                <td className="p-2 text-right space-x-1 whitespace-nowrap">
                  {c.status === "pending" && canDecide(role) && <><Btn onClick={() => setDlg({ kind: "verify", id: c.id })}>Verify</Btn><Btn onClick={() => setDlg({ kind: "reject", id: c.id })}>Reject</Btn></>}
                  {c.status === "verified" && canDecide(role) && <Btn onClick={() => setDlg({ kind: "reverse", id: c.id })}>Reverse</Btn>}
                  {(c.status === "pending" || c.status === "expired") && role === "owner" && <Btn onClick={() => setDlg({ kind: "extend", id: c.id })}>Extend</Btn>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </ModalBody>
      <ModalFooter><ModalButton onClick={onClose}>Close</ModalButton></ModalFooter>

      {dlg?.kind === "record" && chargeMap[dlg.chargeId] && (
        <RecordDialog charge={chargeMap[dlg.chargeId]} title={label(dlg.chargeId)} onClose={() => setDlg(null)} onSubmit={(i) => {
          const err = validateRecord(i, chargeMap[dlg.chargeId], colls, role, new Date());
          if (err) return toast.error(err);
          const at = new Date();
          setColls((cs) => [...cs, { ...i, id: crypto.randomUUID(), chargeId: dlg.chargeId, status: "pending", recordedBy: actor, recordedAt: at.toISOString(), expiresAt: addHours(at, PENDING_HOURS), audit: [{ at: at.toISOString(), actor, action: "Recorded (practice)" }] }]);
          toast.success("Recorded as Pending Verification (practice only)"); setDlg(null); setTab("pending");
        }} />
      )}
      {dlg && dlg.kind !== "record" && (() => { const c = colls.find((x) => x.id === dlg.id)!; return (
        <DecisionDialog kind={dlg.kind} c={c} isSelf={c.recordedBy === actor} onClose={() => setDlg(null)} onSubmit={(f) => {
          const t = new Date(); const ch = chargeMap[c.chargeId] ?? { id: c.chargeId, amount: 0, balance: 0, status: "paid" };
          let err: string | null = null;
          if (dlg.kind === "verify") err = validateVerify(c, ch, colls, role, actor, f.confirmed, f.text, f.self, t);
          if (dlg.kind === "reject") err = validateReason(role, c, "pending", f.text);
          if (dlg.kind === "reverse") err = validateReason(role, c, "verified", f.text);
          if (dlg.kind === "extend") err = validateExtend(role, c, f.text, t);
          if (err) return toast.error(err);
          if (dlg.kind === "verify") { setVerified((v) => ({ ...v, [c.chargeId]: (v[c.chargeId] ?? 0) + c.amount })); patch(c.id, (x) => ({ ...x, status: "verified", decidedBy: actor, selfException: f.self || undefined, audit: log(x, f.self ? "Verified — Owner self-verification exception" : "Verified", f.self || f.text) })); }
          if (dlg.kind === "reject") patch(c.id, (x) => ({ ...x, status: "rejected", reason: f.text, audit: log(x, "Rejected", f.text) }));
          if (dlg.kind === "reverse") { setVerified((v) => ({ ...v, [c.chargeId]: (v[c.chargeId] ?? 0) - c.amount })); patch(c.id, (x) => ({ ...x, status: "reversed", reason: f.text, audit: log(x, "Reversed", f.text) })); }
          if (dlg.kind === "extend") patch(c.id, (x) => ({ ...x, status: "pending", expiresAt: addHours(t, PENDING_HOURS), audit: log(x, `Deadline extended ${PENDING_HOURS} hours`, f.text) }));
          toast.success("Done (practice only)"); setDlg(null);
        }} />); })()}
    </ModalShell>
  );
}

function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">{children}</button>;
}
function Table({ head, empty, children }: { head: string[]; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground"><tr>{head.map((h, i) => <th key={i} className="p-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{children.length ? children : <tr><td colSpan={head.length} className="p-6 text-center text-muted-foreground">{empty}</td></tr>}</tbody>
      </table>
    </div>
  );
}
function History({ c }: { c: Collection }) {
  return (
    <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">History ({c.audit.length})</summary>
      <ul className="mt-1 space-y-0.5">{c.audit.map((a, i) => <li key={i}>{fmtDateTime(a.at)} · {a.actor} · {a.action}{a.reason ? ` — ${a.reason}` : ""}</li>)}</ul>
    </details>
  );
}

function RecordDialog({ charge, title, onClose, onSubmit }: { charge: Charge; title: string; onClose: () => void; onSubmit: (i: { method: Method; amount: number; receivedOn: string; reference?: string; hasReceipt: boolean; cashRecipient?: string; notes?: string }) => void }) {
  const [method, setMethod] = useState<Method>("zelle");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [cashRecipient, setCashRecipient] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <ModalShell onClose={onClose} size="md" label="Record Payment" z="z-[60]">
      <ModalHeader title="Record Payment" subtitle={`${title} · Open $${charge.balance.toFixed(2)}`} onClose={onClose} />
      <ModalBody>
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <label>Method<select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as Method)}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Amount<input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
          <label>Date Received<input type="date" className={inputCls} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></label>
          <label>Transaction Reference<input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Confirmation number" /></label>
          {method === "cash" && <label className="sm:col-span-2">Received By<input className={inputCls} value={cashRecipient} onChange={(e) => setCashRecipient(e.target.value)} /></label>}
          <label className="sm:col-span-2">Notes<textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <div className="sm:col-span-2">
            <div className="mb-1">Receipt</div>
            <FileUploader value={files} onChange={setFiles} accept="image/*,application/pdf" multiple={false} />
            <p className="mt-1 text-xs text-muted-foreground">Practice Mode: the receipt is checked but not uploaded. A screenshot supports a claim; it is not proof the money arrived.</p>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" onClick={() => onSubmit({ method, amount: Number(amount), receivedOn, reference: reference || undefined, hasReceipt: files.length > 0, cashRecipient, notes })}>Record Pending</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

const DTITLE = { verify: "Verify Payment", reject: "Reject Payment", reverse: "Reverse Payment", extend: "Extend Deadline" } as const;
function DecisionDialog({ kind, c, isSelf, onClose, onSubmit }: { kind: keyof typeof DTITLE; c: Collection; isSelf: boolean; onClose: () => void; onSubmit: (f: { confirmed: boolean; text: string; self: string }) => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [text, setText] = useState("");
  const [self, setSelf] = useState("");
  return (
    <ModalShell onClose={onClose} size="sm" label={DTITLE[kind]} z="z-[60]">
      <ModalHeader title={DTITLE[kind]} subtitle={`${METHOD_LABEL[c.method]} · $${c.amount.toFixed(2)} · recorded by ${c.recordedBy}`} onClose={onClose} />
      <ModalBody>
        <div className="space-y-3 text-sm">
          {kind === "verify" && <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I confirmed the money arrived in our account or cash drawer.</label>}
          <label className="block">{kind === "verify" ? "How You Checked" : "Reason"}<textarea className={inputCls} rows={2} value={text} onChange={(e) => setText(e.target.value)} /></label>
          {kind === "verify" && isSelf && <label className="block">Self-Verification Exception Reason (Owner Only)<textarea className={inputCls} rows={2} value={self} onChange={(e) => setSelf(e.target.value)} /></label>}
        </div>
      </ModalBody>
      <ModalFooter><ModalButton onClick={onClose}>Cancel</ModalButton><ModalButton variant="primary" onClick={() => onSubmit({ confirmed, text, self })}>{DTITLE[kind].split(" ")[0]}</ModalButton></ModalFooter>
    </ModalShell>
  );
}
