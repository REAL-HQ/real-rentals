// Rental agreements that came in through Fleet Inbox (including older ones the
// reader filed as purchase agreements). A Manager files each to the renter as
// Original or Swap; the Owner/Manager then reviews and Verifies it on the
// renter's Documents tab. Filing moves no bytes and certifies nothing.
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { fileInboxAgreement, listFiledAgreements, listFileableRenters, listUnfiledInboxAgreements } from "@/lib/inbox-agreement.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Row = { documentId: string; fileName: string | null; category: string; createdAt: string; batchId: string | null };
type Renter = { id: string; name: string; email: string };
type Filed = { id: string; label: string | null; fileName: string | null; role: "original" | "swap" | null; reviewStatus: string };

export function AgreementFilingPanel() {
  const list = useServerFn(listUnfiledInboxAgreements);
  const renters = useServerFn(listFileableRenters);
  const filed = useServerFn(listFiledAgreements);
  const file = useServerFn(fileInboxAgreement);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [people, setPeople] = useState<Renter[]>([]);
  const [hidden, setHidden] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await list()); setPeople(await renters()); } catch { setHidden(true); } // non-Managers: panel hidden
  }, [list, renters]);
  useEffect(() => { void load(); }, [load]);
  if (hidden || !rows || rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-[#F3D9A4] bg-[#FFFBF2] p-4 space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold text-[#111114]">Agreements</h3>
        <p className="text-xs text-[#55555E]">These Are Renter Agreements, Not Vehicle Documents. File Each To Its Renter, Then Verify It On The Renter's Documents Tab.</p>
      </div>
      {rows.map((r) => <FileRow key={r.documentId} row={r} people={people} filed={filed} file={file} onDone={load} />)}
    </div>
  );
}

function FileRow({ row, people, filed, file, onDone }: { row: Row; people: Renter[]; filed: any; file: any; onDone: () => void }) {
  const [app, setApp] = useState("");
  const [role, setRole] = useState<"original" | "swap">("original");
  const [prior, setPrior] = useState<Filed[]>([]);
  const [related, setRelated] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!app) { setPrior([]); return; }
    void (async () => { try { setPrior(await filed({ data: { applicationId: app } })); } catch { setPrior([]); } })();
  }, [app, filed]);
  const originals = prior.filter((p) => p.role !== "swap");
  async function submit() {
    if (!app) return;
    setBusy(true);
    try {
      const r = await file({ data: { documentId: row.documentId, applicationId: app, role, relatedDocumentId: role === "swap" ? related || null : null } });
      if (r.ok) { toast.success("Filed To Renter. Review And Verify It On Their Documents Tab."); onDone(); }
      else toast.error(r.error);
    } catch { toast.error("Could not file this agreement. Retry."); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium text-[#111114]">{row.fileName ?? "Agreement"}</span>
      {/* Shared Select: its panel is a white in-page list, so the opened menu
          never falls back to the browser's dark system popup. */}
      <Select value={app} onValueChange={setApp}>
        <SelectTrigger aria-label="Renter" className="w-auto min-w-[9rem] rounded-md border-[#EDEDF0] bg-white text-foreground">
          <SelectValue placeholder="Renter" />
        </SelectTrigger>
        <SelectContent>
          {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name || p.email}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={role} onValueChange={(v) => setRole(v as "original" | "swap")}>
        <SelectTrigger aria-label="Agreement Type" className="w-auto min-w-[8rem] rounded-md border-[#EDEDF0] bg-white text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="original">Original</SelectItem>
          <SelectItem value="swap" disabled={!originals.length}>Swap</SelectItem>
        </SelectContent>
      </Select>
      {role === "swap" && (
        <Select value={related} onValueChange={setRelated}>
          <SelectTrigger aria-label="Follows" className="w-auto min-w-[12rem] rounded-md border-[#EDEDF0] bg-white text-foreground">
            <SelectValue placeholder="Follows" />
          </SelectTrigger>
          <SelectContent>
            {originals.map((o) => <SelectItem key={o.id} value={o.id}>{o.fileName ?? o.label ?? o.id.slice(0, 8)}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <button type="button" disabled={!app || busy || (role === "swap" && !related)} onClick={() => void submit()} className="min-h-[36px] rounded-md bg-[#D03020] text-white px-4 font-medium disabled:opacity-50">File</button>
    </div>
  );
}
