import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";

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

export function MessagesPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) toast.error(error.message);
    setMsgs((data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function markRead(id: string) {
    const { error } = await supabase.from("messages").update({ read: true }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  const visible = filter === "unread" ? msgs.filter((m) => !m.read) : msgs;
  const grouped = new Map<string, Msg[]>();
  for (const m of visible) {
    const arr = grouped.get(m.thread_id) ?? [];
    arr.push(m);
    grouped.set(m.thread_id, arr);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm">
          <option value="all">All</option>
          <option value="unread">Unread</option>
        </select>
        <span className="text-sm text-muted-foreground">{visible.length} message(s) in {grouped.size} thread(s)</span>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : visible.length === 0 ? (
        <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm p-10 text-center text-muted-foreground">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No messages.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([thread, items]) => (
            <div key={thread} className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
              <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground">
                Thread <code>{thread.slice(0, 8)}</code> · {items.length} message(s)
              </div>
              <ul className="divide-y divide-border">
                {items.map((m) => (
                  <li key={m.id} className={`px-4 py-3 ${!m.read ? "bg-amber-50" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm">{m.body}</div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</div>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="capitalize">{m.kind}</span>
                      {!m.read && <button onClick={() => markRead(m.id)} className="text-real-red hover:underline">Mark Read</button>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}