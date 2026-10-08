import { AlertTriangle, Banknote, Car, Copy, Eye, Link2 } from "lucide-react";
import { MONEY_EVENT_LABELS, moneyOf, type FinancialExtraction, type FinancialReview, type MoneyEvent } from "@/lib/financial-docs";
import { docClassLabel } from "@/lib/fleet-inbox";

// Step B review: shows what a payment / receipt document says and how it relates
// to existing records. Read-only — nothing here posts an expense or assigns a vehicle.
export function FinancialDocumentReview({ d, isManager, openFile }: { d: any; isManager: boolean; openFile: (documentId: string) => void }) {
  if (!isManager) return null;
  const items = (d.items ?? []).filter((i: any) => i.extraction?.financial);
  if (!items.length) return null;
  const nameOf = (id: string) => d.items.find((x: any) => x.id === id)?.file_name ?? "Another Document";
  return (
    <section className="rounded-xl border border-[#EDEDF0] bg-white">
      <header className="px-4 py-3 border-b border-[#EDEDF0] flex items-center gap-2">
        <Banknote className="w-4 h-4 text-[#55555E]" />
        <span className="text-[13px] font-semibold">Financial Documents</span>
        <span className="ml-auto text-xs text-[#9A9AA3]">Review Only · Nothing Is Posted</span>
      </header>
      <div className="divide-y divide-[#EDEDF0]">
        {items.map((it: any) => {
          const f: FinancialExtraction = it.extraction.financial;
          const r: FinancialReview | null = it.extraction.financialReview;
          const amt = moneyOf(f.amount);
          const row = (label: string, v?: { value: string; confidence: string } | string | null) => {
            const val = typeof v === "string" ? v : v?.value;
            if (!val) return null;
            const low = typeof v === "object" && v?.confidence === "low";
            return (
              <div className="flex gap-2 text-xs">
                <span className="w-28 shrink-0 text-[#9A9AA3]">{label}</span>
                <span className={`min-w-0 break-words ${low ? "text-[#B45309]" : "text-[#111114]"}`}>{val}{low ? " (Hard To Read)" : ""}</span>
              </div>
            );
          };
          return (
            <div key={it.id} className="px-4 py-4 space-y-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{MONEY_EVENT_LABELS[f.event as MoneyEvent] ?? "Unclear"}{amt != null ? ` · $${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : ""}</div>
                  <div className="text-xs text-[#9A9AA3] truncate">{docClassLabel(it.doc_class)} · {it.file_name}</div>
                </div>
                {it.document_id && (
                  <button onClick={() => openFile(it.document_id)} className="min-h-[36px] px-2 text-xs inline-flex items-center gap-1 text-[#55555E] hover:text-[#111114]"><Eye className="w-3.5 h-3.5" /> View</button>
                )}
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                {row("Vendor", f.vendor)}
                {row("Payee", f.payee)}
                {row("Date", f.date)}
                {row("Method", f.method)}
                {row("Reference", f.reference)}
                {row("Invoice", f.invoiceNumber)}
                {row("Memo", f.memo)}
                {row("Description", f.description)}
                {row("Status", f.status)}
                {row("Account", f.accountLast4 ? `Ending ${f.accountLast4}` : null)}
              </div>
              {r && r.duplicates.length > 0 && (
                <div className="rounded-lg bg-[#FEF3F2] px-3 py-2 text-xs text-[#B42318] space-y-1">
                  {r.duplicates.map((x, k) => (
                    <div key={k} className="flex gap-1.5"><Copy className="w-3.5 h-3.5 shrink-0 mt-px" /><span><b>{x.strength === "certain" ? "Duplicate" : x.strength === "likely" ? "Likely Duplicate" : "Possible Duplicate"}</b> Of {x.target.type === "expense" ? x.target.label : nameOf(x.target.id)} — {x.reason}</span></div>
                  ))}
                </div>
              )}
              {r && r.correspondences.length > 0 && (
                <div className="rounded-lg bg-[#F0F7FF] px-3 py-2 text-xs text-[#1D4ED8] space-y-1">
                  {r.correspondences.map((x, k) => (
                    <div key={k} className="flex gap-1.5"><Link2 className="w-3.5 h-3.5 shrink-0 mt-px" /><span><b>{x.relation === "partially_pays" ? "Partial Payment For" : x.relation === "same_expense" ? "Already Recorded As" : x.relation === "paid_by" ? "Paid By" : "Pays"}</b> {x.target.type === "fleet_document" ? nameOf(x.target.id) : x.target.label} — {x.reason}</span></div>
                  ))}
                </div>
              )}
              {r && (
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-[#55555E]"><Car className="w-3.5 h-3.5" /> Vehicle {r.vehicleStatus === "ambiguous" ? "Ambiguous" : r.vehicleStatus === "identified_unassigned" ? "Identified · Not Assigned" : r.vehicleStatus === "none_found" ? "No Fleet Match" : "Not Mentioned"}</div>
                  {r.suggestions.map((s) => (
                    <div key={s.vehicleId} className="pl-5 text-[#111114]">{s.label} <span className="text-[#9A9AA3]">— {s.evidence.join(", ")}</span></div>
                  ))}
                </div>
              )}
              {r && r.uncertainties.length > 0 && (
                <div className="text-xs text-[#B45309] space-y-0.5">
                  {r.uncertainties.map((u, k) => <div key={k} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /><span>{u}</span></div>)}
                </div>
              )}
              <div className="text-[11px] text-[#9A9AA3]">No Expense Has Been Created And No Vehicle Has Been Assigned.</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
