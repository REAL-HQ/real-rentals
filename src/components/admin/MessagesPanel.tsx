import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessageSquare, Search, Paperclip, Phone, ExternalLink, Send } from "lucide-react";

type Msg = {
  id: string;
  thread_id: string;
  body: string;
  kind: string;
  driver_id: string | null;
  partner_id: string | null;
  sender_id: string | null;
  recipient_id: string | null;
  read: boolean;
  created_at: string;
};

type Contact = { id: string; name: string; kind: "driver" | "partner"; sub?: string };

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
}
function fmtWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function MessagesPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread" | "drivers" | "partners">("all");
  const [query, setQuery] = useState("");
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [vehicleByDriver, setVehicleByDriver] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) toast.error(error.message);
    const rows: Msg[] = (data as any) ?? [];
    setMsgs(rows);

    const driverIds = Array.from(new Set(rows.map((m) => m.driver_id).filter(Boolean))) as string[];
    const partnerIds = Array.from(new Set(rows.map((m) => m.partner_id).filter(Boolean))) as string[];
    const map: Record<string, Contact> = {};
    const vmap: Record<string, string> = {};
    if (driverIds.length) {
      const { data: drv } = await supabase
        .from("applications")
        .select("id, full_name, vehicle_id, status")
        .in("id", driverIds);
      const vehIds = Array.from(new Set(((drv as any[]) ?? []).map((d) => d.vehicle_id).filter(Boolean)));
      let veh: any[] = [];
      if (vehIds.length) {
        const { data: v } = await supabase.from("vehicles").select("id, year, make, model").in("id", vehIds);
        veh = (v as any[]) ?? [];
      }
      const vById = Object.fromEntries(veh.map((x) => [x.id, `${x.year} ${x.make} ${x.model}`]));
      for (const d of (drv as any[]) ?? []) {
        const vehLabel = d.vehicle_id ? vById[d.vehicle_id] : null;
        map[d.id] = {
          id: d.id,
          name: d.full_name || "Unnamed driver",
          kind: "driver",
          sub: vehLabel ? `${vehLabel} · ${d.status === "active" ? "Active Rental" : (d.status || "Driver")}` : "Driver",
        };
        if (vehLabel) vmap[d.id] = vehLabel;
      }
    }
    if (partnerIds.length) {
      const { data: pt } = await (supabase as any)
        .from("partner_submissions")
        .select("id, full_name, company")
        .in("id", partnerIds);
      for (const p of (pt as any[]) ?? []) {
        map[p.id] = { id: p.id, name: p.full_name || p.company || "Partner", kind: "partner", sub: p.company || "Partner" };
      }
    }
    setContacts(map);
    setVehicleByDriver(vmap);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function markRead(id: string) {
    const { error } = await supabase.from("messages").update({ read: true }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  const threads = useMemo(() => {
    const byThread = new Map<string, Msg[]>();
    for (const m of msgs) {
      const arr = byThread.get(m.thread_id) ?? [];
      arr.push(m);
      byThread.set(m.thread_id, arr);
    }
    const list = Array.from(byThread.entries()).map(([tid, items]) => {
      const ordered = [...items].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      const latest = ordered[ordered.length - 1];
      const contactId = latest.driver_id || latest.partner_id;
      const contact = contactId ? contacts[contactId] : null;
      const kind: "driver" | "partner" = latest.partner_id ? "partner" : "driver";
      const unread = items.filter((m) => !m.read).length;
      return { threadId: tid, items: ordered, latest, contact, kind, unread };
    });
    return list.sort((a, b) => (a.latest.created_at < b.latest.created_at ? 1 : -1));
  }, [msgs, contacts]);

  const filteredThreads = useMemo(() => {
    let list = threads;
    if (filter === "unread") list = list.filter((t) => t.unread > 0);
    if (filter === "drivers") list = list.filter((t) => t.kind === "driver");
    if (filter === "partners") list = list.filter((t) => t.kind === "partner");
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((t) =>
        (t.contact?.name || "").toLowerCase().includes(q) ||
        (t.latest.body || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [threads, filter, query]);

  const active = useMemo(
    () => filteredThreads.find((t) => t.threadId === activeThread) ?? filteredThreads[0] ?? null,
    [filteredThreads, activeThread]
  );

  const totalUnread = threads.reduce((n, t) => n + t.unread, 0);

  return (
    <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[320px,1fr] h-[640px]">
        {/* Left pane */}
        <aside className="border-r border-[#EDEDF0] flex flex-col min-h-0">
          <div className="px-3 pt-3 pb-2 border-b border-[#EDEDF0]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9A9AA3]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search conversations"
                className="w-full pl-8 pr-3 py-2 text-[13px] rounded-lg bg-[#FAFAFB] border border-[#EDEDF0] focus:outline-none focus:border-[#C4C4CB]"
              />
            </div>
            <div className="mt-2 flex items-center gap-1 text-[11px]">
              {([
                ["all", `All${msgs.length ? ` · ${threads.length}` : ""}`],
                ["unread", `Unread${totalUnread ? ` · ${totalUnread}` : ""}`],
                ["drivers", "Drivers"],
                ["partners", "Partners"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k as any)}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    filter === k ? "bg-[#111114] text-white" : "text-[#55555E] hover:bg-[#F4F4F6]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-[12px] text-[#9A9AA3]">Loading…</div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-[#9A9AA3]">
                <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p className="text-[12px]">No conversations.</p>
              </div>
            ) : (
              <ul>
                {filteredThreads.map((t) => {
                  const isActive = active?.threadId === t.threadId;
                  const name = t.contact?.name || (t.kind === "partner" ? "Partner" : "Driver");
                  return (
                    <li key={t.threadId}>
                      <button
                        onClick={() => setActiveThread(t.threadId)}
                        className={`w-full text-left px-3 py-2.5 border-b border-[#F4F4F6] flex items-start gap-2.5 transition-colors ${
                          isActive ? "bg-[#FAFAFB]" : "hover:bg-[#FAFAFB]"
                        }`}
                      >
                        <div className="w-8 h-8 rounded-full bg-[#F4F4F6] text-[#55555E] grid place-items-center text-[11px] font-semibold shrink-0">
                          {initials(name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-[#111114] truncate">{name}</span>
                            <span className="ml-auto text-[10px] text-[#9A9AA3] tabular-nums shrink-0">{fmtWhen(t.latest.created_at)}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[12px] text-[#55555E] truncate flex-1">{t.latest.body}</span>
                            {t.unread > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[#CC0000] shrink-0" />}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Right pane */}
        <section className="flex flex-col min-h-0 bg-[#FAFAFB]">
          {!active ? (
            <div className="flex-1 grid place-items-center text-[#9A9AA3] text-[13px]">
              Select a conversation
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 px-5 py-3 border-b border-[#EDEDF0] bg-white">
                <div className="w-9 h-9 rounded-full bg-[#F4F4F6] text-[#55555E] grid place-items-center text-[12px] font-semibold shrink-0">
                  {initials(active.contact?.name || "?")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-[#111114] truncate">
                    {active.contact?.name || (active.kind === "partner" ? "Partner" : "Driver")}
                  </div>
                  <div className="text-[11px] text-[#9A9AA3] truncate">{active.contact?.sub || active.kind}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="h-8 w-8 grid place-items-center rounded-md text-[#55555E] hover:bg-[#F4F4F6]" title="Call">
                    <Phone className="w-4 h-4" />
                  </button>
                  {active.contact && (
                    <a
                      href={`/admin?tab=${active.kind === "partner" ? "partners" : "drivers"}&id=${active.contact.id}`}
                      className="h-8 w-8 grid place-items-center rounded-md text-[#55555E] hover:bg-[#F4F4F6]"
                      title="Open profile"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </header>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {active.items.map((m) => {
                  const outbound = !!m.sender_id;
                  return (
                    <div key={m.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug shadow-sm ${
                          outbound
                            ? "bg-[#111114] text-white rounded-br-sm"
                            : "bg-white text-[#111114] border border-[#EDEDF0] rounded-bl-sm"
                        }`}
                      >
                        <div>{m.body}</div>
                        <div className={`mt-1 text-[10px] ${outbound ? "text-white/60" : "text-[#9A9AA3]"} flex items-center gap-1.5`}>
                          <span>{fmtWhen(m.created_at)}</span>
                          {!m.read && !outbound && (
                            <button onClick={() => markRead(m.id)} className="underline hover:text-[#CC0000]">Mark read</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <footer className="px-4 py-3 border-t border-[#EDEDF0] bg-white flex items-center gap-2">
                <button className="h-9 w-9 grid place-items-center rounded-md text-[#55555E] hover:bg-[#F4F4F6]" title="Attach">
                  <Paperclip className="w-4 h-4" />
                </button>
                <input
                  placeholder="Write a message…"
                  className="flex-1 h-9 px-3 text-[13px] rounded-lg border border-[#EDEDF0] focus:outline-none focus:border-[#C4C4CB] bg-white"
                />
                <button className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md bg-[#CC0000] text-white text-[13px] font-medium hover:opacity-90">
                  <Send className="w-3.5 h-3.5" /> Send
                </button>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}