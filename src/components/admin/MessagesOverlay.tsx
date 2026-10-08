import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  X, Search, SquarePen, CheckCheck, ArrowLeft, Info, Mail, MessageSquare, Send, Loader2, ExternalLink, Phone, Car, StickyNote,
} from "lucide-react";
import {
  listConversations, getConversation, markConversationRead, searchMessagePeople, sendStaffMessage,
  type ConversationSummary, type ThreadMessage, type PersonInfo, type RentalInfo,
} from "@/lib/messages.functions";
import { fmtDate } from "@/lib/date-format";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
}
const AV = ["#E5484D", "#0EA5E9", "#F59E0B", "#3B82F6", "#8B5CF6", "#10B981", "#EC4899", "#F97316"];
function avColor(key: string) {
  let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV[h % AV.length];
}
function Avatar({ name, id, size = 40 }: { name: string; id: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, background: avColor(id), fontSize: size * 0.4 }}
      className="rounded-full text-white grid place-items-center font-semibold shrink-0">{name.trim()[0]?.toUpperCase() ?? "?"}</div>
  );
}
function fmtAgo(iso: string) {
  const m = Math.max(0, (Date.now() - new Date(iso).getTime()) / 6e4);
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : fmtDate(d);
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return fmtDate(d);
}
const STATE_LABEL: Record<string, string> = {
  sending: "Sending…", accepted: "Sent", sent: "Sent", delivered: "Delivered", failed: "Not delivered",
  bounced: "Bounced", complained: "Marked as spam", skipped: "Not sent",
};
const CH_ICON = { email: Mail, sms: MessageSquare, internal: StickyNote, system: Info } as const;
const CH_LABEL = { email: "Email", sms: "Text", internal: "Note", system: "System" } as const;

type Filter = "all" | "unread";

export function MessagesOverlay({
  open, applicationId, onSelect, onClose, onUnreadChange,
}: {
  open: boolean;
  /** Selected conversation, owned by the URL so close returns exactly to where you were. */
  applicationId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  onUnreadChange?: (n: number) => void;
}) {
  const list = useServerFn(listConversations);
  const get = useServerFn(getConversation);
  const markRead = useServerFn(markConversationRead);
  const search = useServerFn(searchMessagePeople);
  const send = useServerFn(sendStaffMessage);

  const [convs, setConvs] = useState<ConversationSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [thread, setThread] = useState<{ person: PersonInfo; messages: ThreadMessage[]; rental: RentalInfo | null } | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [mobile, setMobile] = useState<"list" | "thread" | "info">("list");
  const [showInfo, setShowInfo] = useState(true);
  const [composing, setComposing] = useState(false);
  const [people, setPeople] = useState<Awaited<ReturnType<typeof search>>>([]);
  const [peopleQ, setPeopleQ] = useState("");
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [chFilter, setChFilter] = useState<"all" | "email" | "sms">("all");
  const [tab, setTab] = useState<"details" | "rental">("details");
  const endRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await list();
      setConvs(r.conversations);
      onUnreadChange?.(r.unread);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load messages");
      setConvs([]);
    }
  }, [list, onUnreadChange]);

  const loadThread = useCallback(async (id: string) => {
    setLoadingThread(true);
    try {
      const r = await get({ data: { applicationId: id } });
      setThread(r);
      setChannel(r.person.email_channel.available ? "email" : r.person.sms_channel.available ? "sms" : "email");
      const last = [...r.messages].reverse().find((m) => m.channel === "email" || m.channel === "sms");
      if (last && (last.channel === "email" ? r.person.email_channel.available : r.person.sms_channel.available)) setChannel(last.channel as "email" | "sms");
      void markRead({ data: { applicationId: id } }).then(loadList);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open conversation");
      setThread(null);
    } finally {
      setLoadingThread(false);
    }
  }, [get, markRead, loadList]);

  useEffect(() => { if (open) void loadList(); }, [open, loadList]);
  useEffect(() => {
    if (!open) return;
    if (applicationId) { setComposing(false); setMobile("thread"); void loadThread(applicationId); }
    else { setThread(null); setMobile("list"); }
  }, [open, applicationId, loadThread]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [thread?.messages.length]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  useEffect(() => {
    if (!composing || peopleQ.trim().length < 2) { setPeople([]); return; }
    const t = setTimeout(() => { void search({ data: { q: peopleQ } }).then(setPeople).catch(() => setPeople([])); }, 250);
    return () => clearTimeout(t);
  }, [composing, peopleQ, search]);

  const shown = useMemo(() => {
    let l = convs ?? [];
    if (filter === "unread") l = l.filter((c) => c.unread > 0);
    if (chFilter !== "all") l = l.filter((c) => c.lastChannel === chFilter);
    const q = query.trim().toLowerCase();
    if (q) l = l.filter((c) => c.name.toLowerCase().includes(q) || c.lastBody.toLowerCase().includes(q));
    return l;
  }, [convs, filter, query, chFilter]);

  async function submit() {
    if (!thread || !body.trim()) return;
    setSending(true);
    try {
      const r = await send({ data: { applicationId: thread.person.applicationId, channel, body: body.trim(), subject: channel === "email" ? subject.trim() || undefined : undefined } });
      if (r.ok) { setBody(""); setSubject(""); toast.success(channel === "email" ? "Email sent" : "Text sent"); }
      else toast.error(r.error ?? "Message was not sent");
      await loadThread(thread.person.applicationId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Message was not sent");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;
  const person = thread?.person;
  const chAvail = person ? (channel === "email" ? person.email_channel : person.sms_channel) : null;
  const noChannel = person && !person.email_channel.available && !person.sms_channel.available;

  const hasBothChannels = !!convs && convs.some((c) => c.lastChannel === "sms") && convs.some((c) => c.lastChannel === "email");
  const listPane = (
    <aside className={`${mobile === "list" ? "flex" : "hidden"} md:flex flex-col min-h-0 border-r border-[#EDEDF0] bg-white`}>
      <div className="px-4 md:px-3 pt-4 pb-3 border-b border-[#EDEDF0]">
        <div className="flex items-center gap-1">
          <h2 className="text-[17px] font-semibold text-[#111114] mr-auto">Messages</h2>
          <button aria-label="Search conversations" title="Search" onClick={() => setSearchOpen((v) => !v)}
            className="w-9 h-9 grid place-items-center rounded-lg text-[#55555E] hover:bg-[#F4F4F6]"><Search className="w-[18px] h-[18px]" /></button>
          <button aria-label="Mark all as read" title="Mark All as Read" disabled={!convs?.some((c) => c.unread > 0)}
            onClick={async () => { for (const c of convs ?? []) if (c.unread > 0) await markRead({ data: { applicationId: c.applicationId } }); void loadList(); }}
            className="w-9 h-9 grid place-items-center rounded-lg text-[#55555E] hover:bg-[#F4F4F6] disabled:text-[#C4C4CB] disabled:hover:bg-transparent"><CheckCheck className="w-[18px] h-[18px]" /></button>
          <button aria-label="New Message" title="New Message"
            onClick={() => { setComposing(true); setPeopleQ(""); onSelect(null); setMobile("thread"); }}
            className="w-9 h-9 grid place-items-center rounded-lg text-[#55555E] hover:bg-[#F4F4F6]"><SquarePen className="w-[18px] h-[18px]" /></button>
        </div>
        {searchOpen && (
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9A9AA3]" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations text"
              className="w-full h-10 pl-9 pr-3 text-[13px] rounded-lg bg-white border border-[#E4E4E8] focus:outline-none focus:border-[#C4C4CB]" />
          </div>
        )}
        <div className={`mt-3 grid gap-2 ${hasBothChannels ? "grid-cols-2" : "grid-cols-1"}`}>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter conversations"
            style={{ colorScheme: "light" }}
            className="h-10 px-3 text-[13px] rounded-lg bg-white border border-[#E4E4E8] text-[#33333A] focus:outline-none">
            <option value="all">All Conversations</option>
            <option value="unread">Unread</option>
          </select>
          {hasBothChannels && (
            <select value={chFilter} onChange={(e) => setChFilter(e.target.value as typeof chFilter)} aria-label="Channel"
              style={{ colorScheme: "light" }}
              className="h-10 px-3 text-[13px] rounded-lg bg-white border border-[#E4E4E8] text-[#33333A] focus:outline-none">
              <option value="all">All Channels</option>
              <option value="sms">Text</option>
              <option value="email">Email</option>
            </select>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {convs === null ? (
          <div className="p-6 text-[12px] text-[#9A9AA3]">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center text-[#9A9AA3]">
            <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-[13px] text-[#55555E] font-medium">{convs.length === 0 ? "No conversations yet" : "Nothing matches"}</p>
            {convs.length === 0 && <p className="text-[12px] mt-1">Start one with New Message.</p>}
          </div>
        ) : (
          <ul>
            {shown.map((c) => {
              const Icon = CH_ICON[c.lastChannel] ?? MessageSquare;
              const active = c.applicationId === applicationId;
              return (
                <li key={c.applicationId}>
                  <button onClick={() => onSelect(c.applicationId)}
                    className={`w-full text-left px-4 py-4 flex gap-3 border-b border-[#EDEDF0] ${active ? "bg-[#FAFAFB]" : "hover:bg-[#FAFAFB]"}`}>
                    <Avatar name={c.name} id={c.applicationId} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-semibold truncate text-[#111114]">{c.name}</span>
                        <span className="ml-auto text-[12px] text-[#9A9AA3] tabular-nums shrink-0">{fmtAgo(c.lastAt)}</span>
                        {c.unread > 0 && <span aria-label={`${c.unread} unread`} className="w-2 h-2 rounded-full bg-[#F59E0B] shrink-0" />}
                      </div>
                      <p className="mt-0.5 text-[13px] leading-snug text-[#55555E] line-clamp-2 break-words">{c.lastBody}</p>
                      <div className="mt-1 flex items-center gap-1.5 text-[12px] font-medium text-[#9A9AA3]">
                        <Icon className="w-3 h-3" />{CH_LABEL[c.lastChannel] ?? "Message"}
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
  );

  const groups: { day: string; items: ThreadMessage[] }[] = [];
  for (const m of thread?.messages ?? []) {
    const day = dayLabel(m.createdAt);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(m); else groups.push({ day, items: [m] });
  }

  const centerPane = (
    <section className={`${mobile === "thread" ? "flex" : "hidden"} md:flex flex-col min-h-0 bg-white`}>
      {composing && !applicationId ? (
        <div className="flex-1 flex flex-col min-h-0">
          <header className="flex items-center gap-2 px-4 h-14 border-b border-[#EDEDF0] bg-white">
            <button aria-label="Back" onClick={() => { setComposing(false); setMobile("list"); }} className="md:hidden w-11 h-11 -ml-2 grid place-items-center rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
            <div className="text-[14px] font-semibold">New Message</div>
          </header>
          <div className="p-4">
            <label className="text-[11px] uppercase tracking-wider text-[#9A9AA3] font-semibold">To</label>
            <input autoFocus value={peopleQ} onChange={(e) => setPeopleQ(e.target.value)} placeholder="Search drivers and applicants by name, email or phone"
              className="mt-1 w-full h-11 px-3 text-[14px] rounded-lg bg-white border border-[#EDEDF0] focus:outline-none focus:border-[#C4C4CB]" />
            <ul className="mt-2 rounded-lg bg-white border border-[#EDEDF0] divide-y divide-[#F4F4F6] empty:hidden">
              {people.map((p) => (
                <li key={p.id}>
                  <button onClick={() => { setComposing(false); onSelect(p.id); }} className="w-full text-left px-3 py-2.5 min-h-[48px] hover:bg-[#FAFAFB] flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#F4F4F6] text-[#55555E] grid place-items-center text-[11px] font-semibold">{initials(p.name)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate">{p.name}</div>
                      <div className="text-[11px] text-[#9A9AA3]">{[p.status, p.hasEmail ? "Email" : null, p.hasPhone ? "Phone" : null].filter(Boolean).join(" · ")}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {peopleQ.trim().length >= 2 && people.length === 0 && <p className="mt-3 text-[12px] text-[#9A9AA3]">No matching drivers or applicants.</p>}
          </div>
        </div>
      ) : !applicationId ? (
        <div className="flex-1 grid place-items-center text-[13px] text-[#9A9AA3]">Select a conversation or start a new one.</div>
      ) : (
        <>
          <header className="flex items-center gap-3 px-4 h-[72px] border-b border-[#EDEDF0] bg-white shrink-0">
            <button aria-label="Back to conversations" onClick={() => { onSelect(null); setMobile("list"); }} className="md:hidden w-11 h-11 -ml-2 grid place-items-center rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
            <Avatar name={person?.name ?? "?"} id={applicationId} size={34} />
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-semibold truncate text-[#111114]">{person?.name ?? "Loading…"}</div>
              <div className="text-[12px] text-[#77777F] truncate capitalize">{person?.status ?? ""}</div>
            </div>
            <button aria-label="Conversation info" onClick={() => { setShowInfo((v) => !v); setMobile("info"); }}
              title="Conversation Info"
              className="w-10 h-10 grid place-items-center rounded-lg border border-[#E4E4E8] text-[#55555E] hover:bg-[#F4F4F6]"><Info className="w-5 h-5" /></button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            {loadingThread && !thread ? (
              <div className="text-[12px] text-[#9A9AA3]">Loading…</div>
            ) : groups.length === 0 ? (
              <div className="h-full grid place-items-center text-center text-[13px] text-[#9A9AA3]">No messages with {person?.name ?? "this person"} yet.</div>
            ) : (
              groups.map((g) => (
                <div key={g.day} className="mb-3">
                  <div className="my-4 flex items-center gap-4 text-[12px] font-medium text-[#55555E]"><span className="h-px flex-1 bg-[#EDEDF0]" />{g.day}<span className="h-px flex-1 bg-[#EDEDF0]" /></div>
                  <div className="space-y-2">
                    {g.items.map((m) => {
                      const out = m.direction !== "inbound";
                      const Icon = CH_ICON[m.channel] ?? MessageSquare;
                      const bad = m.deliveryState && ["failed", "bounced", "complained", "skipped"].includes(m.deliveryState);
                      return (
                        <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[80%] md:max-w-[70%] rounded-xl px-4 py-2.5 text-[14px] leading-relaxed text-[#111114] border ${out ? "bg-[#FFF8EC] border-[#F6E7CC]" : "bg-[#F6F6F8] border-[#EDEDF0]"}`}>
                            <div className="mb-1 flex items-center gap-1.5 text-[12px]">
                              <span className="font-semibold text-[#33333A]">{out ? "You" : person?.name.split(" ")[0]}</span>
                              <span className="text-[#77777F]">{new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                              <span className="text-[#9A9AA3] inline-flex items-center gap-1">· <Icon className="w-3 h-3" />{CH_LABEL[m.channel]}</span>
                            </div>
                            {m.subject && <div className="text-[13px] font-semibold mb-0.5">{m.subject}</div>}
                            <div className="whitespace-pre-wrap break-words">{m.body}</div>
                            {out && m.deliveryState && <div className={`mt-1 text-[11px] ${bad ? "text-[#D03020]" : "text-[#9A9AA3]"}`}>{STATE_LABEL[m.deliveryState] ?? m.deliveryState}</div>}
                            {bad && m.deliveryError && <div className="mt-0.5 text-[11px] text-[#D03020]">{m.deliveryError}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>
          {person && (
            <footer className="shrink-0 border-t border-[#EDEDF0] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
              {noChannel ? (
                <p className="text-[12px] text-[#55555E] px-1 py-2">No delivery method is available for this person right now. {person.email_channel.reason} {person.sms_channel.reason}</p>
              ) : (
                <>
                  {!chAvail?.available && <p className="text-[11px] text-[#9A9AA3] mb-2">{chAvail?.reason}</p>}
                  <div className="rounded-xl border border-[#E4E4E8] bg-white focus-within:border-[#C4C4CB]">
                    {channel === "email" && chAvail?.available && (
                      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject — defaults to “A message from REAL RENTALS”"
                        className="w-full h-10 px-4 text-[14px] bg-transparent border-b border-[#F0F0F2] focus:outline-none" />
                    )}
                    <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} disabled={!chAvail?.available}
                      placeholder={chAvail?.available ? "Write a reply" : "Choose an available delivery method"}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }}
                      className="w-full min-h-[64px] max-h-48 px-4 py-3 text-[14px] bg-transparent focus:outline-none resize-none" />
                    <div className="flex items-center gap-1 px-3 pb-3">
                      {(["email", "sms"] as const).map((c) => {
                        const a = c === "email" ? person.email_channel : person.sms_channel;
                        return (
                          <button key={c} disabled={!a.available} onClick={() => setChannel(c)} title={a.available ? a.address ?? "" : a.reason ?? ""}
                            aria-label={`Send via ${c === "email" ? "Email" : "Text"}`}
                            className={`h-8 px-2.5 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 ${channel === c && a.available ? "bg-[#F4F4F6] text-[#111114]" : a.available ? "text-[#55555E] hover:bg-[#F4F4F6]" : "text-[#C4C4CB] cursor-not-allowed"}`}>
                            {c === "email" ? <Mail className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}{c === "email" ? "Email" : "Text"}
                          </button>
                        );
                      })}
                      <button onClick={() => void submit()} disabled={sending || !body.trim() || !chAvail?.available}
                        className="ml-auto h-9 px-4 rounded-lg bg-[#F59E0B] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-[#E08E06] disabled:opacity-40">
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
                      </button>
                    </div>
                  </div>
                  {channel === "sms" && body.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-[#9A9AA3]">{body.length} characters · {body.length <= 160 ? 1 : Math.ceil(body.length / 153)} text segment{body.length > 160 ? "s" : ""}</p>
                  )}
                  {!person.sms_channel.available && person.sms_channel.reason && channel === "email" && (
                    <p className="mt-1.5 text-[11px] text-[#9A9AA3]">Text unavailable: {person.sms_channel.reason}</p>
                  )}
                  {channel === "email" && chAvail?.available && <p className="mt-1.5 text-[10px] text-[#9A9AA3]">Sent from Team@DriveReal.com. Replies arrive in the Team@ mailbox, not here.</p>}
                </>
              )}
            </footer>
          )}
        </>
      )}
    </section>
  );

  const infoPane = person && applicationId ? (
    <aside className={`${mobile === "info" ? "flex" : "hidden"} md:hidden ${showInfo ? "xl:flex" : ""} flex-col min-h-0 border-l border-[#EDEDF0] bg-white overflow-y-auto`}>
      <div className="flex items-center gap-2 px-4 h-14 border-b border-[#EDEDF0] md:hidden">
        <button aria-label="Back to conversation" onClick={() => setMobile("thread")} className="w-11 h-11 -ml-2 grid place-items-center rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <div className="text-[14px] font-semibold">Info</div>
      </div>
      <div className="hidden md:flex items-center gap-1 px-3 h-14 border-b border-[#EDEDF0]">
        {(thread?.rental ? (["details", "rental"] as const) : (["details"] as const)).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`h-8 px-2.5 rounded-lg text-[13px] inline-flex items-center ${tab === t || !thread?.rental ? "bg-[#F4F4F6] font-semibold text-[#111114]" : "text-[#55555E] hover:bg-[#F4F4F6]"}`}>
            {t === "details" ? "Details" : "Rental"}
          </button>
        ))}
      </div>
      {thread?.rental && (
        <div className="md:hidden flex gap-1 px-3 py-2 border-b border-[#EDEDF0]">
          {(["details", "rental"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`h-9 px-3 rounded-lg text-[13px] ${tab === t ? "bg-[#F4F4F6] font-semibold" : "text-[#55555E]"}`}>{t === "details" ? "Details" : "Rental"}</button>
          ))}
        </div>
      )}
      {tab === "rental" && thread?.rental ? (
        <dl className="p-5 space-y-4 text-[13px]">
          {([
            ["Status", <span className="capitalize">{thread.rental.status.replace(/_/g, " ")}</span>],
            ["Vehicle", thread.rental.vehicle ?? "—"],
            ["Unit", thread.rental.unitNumber ?? "—"],
            ["Start", thread.rental.start ? fmtDate(thread.rental.start + "T00:00") : "—"],
            ["Expected Return", thread.rental.end ? fmtDate(thread.rental.end + "T00:00") : "—"],
            ["Weekly Rate", thread.rental.weeklyRate == null ? "Not Set" : `$${thread.rental.weeklyRate.toLocaleString()}`],
            ...(thread.rental.balanceDue != null ? [["Balance Due", `$${thread.rental.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`] as const] : []),
          ] as const).map(([k, v]) => (
            <div key={k as string}><dt className="text-[11px] uppercase tracking-wider text-[#9A9AA3] font-semibold">{k}</dt><dd className="mt-0.5">{v}</dd></div>
          ))}
        </dl>
      ) : (<>
      <div className="p-5 text-center border-b border-[#EDEDF0]">
        <div className="mx-auto w-fit"><Avatar name={person.name} id={person.applicationId} size={56} /></div>
        <div className="mt-2 text-[15px] font-semibold">{person.name}</div>
        <div className="text-[12px] text-[#9A9AA3] capitalize">{person.status ?? "—"}</div>
        <Link to="/admin" search={{ tab: "drivers", id: person.applicationId }} onClick={onClose}
          className="mt-3 inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-[#EDEDF0] text-[12px] font-medium hover:bg-[#FAFAFB]">
          {person.kind === "driver" ? "View Driver" : "View Applicant"} <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
      <dl className="p-5 space-y-4 text-[13px]">
        <div><dt className="text-[11px] uppercase tracking-wider text-[#9A9AA3] font-semibold flex items-center gap-1.5"><Phone className="w-3 h-3" /> Phone</dt><dd className="mt-0.5">{person.phone ?? "—"}</dd><dd className="text-[11px] text-[#9A9AA3]">{person.sms_channel.available ? "Text available" : person.sms_channel.reason}</dd>{person.phone && <dd className="text-[11px] text-[#9A9AA3]">Text consent: {person.smsOptedOut ? "Opted out" : person.smsConsent ? "Yes" : "Not given"}</dd>}</div>
        <div><dt className="text-[11px] uppercase tracking-wider text-[#9A9AA3] font-semibold flex items-center gap-1.5"><Mail className="w-3 h-3" /> Email</dt><dd className="mt-0.5 break-all">{person.email ?? "—"}</dd><dd className="text-[11px] text-[#9A9AA3]">{person.email_channel.available ? "Email available" : person.email_channel.reason}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wider text-[#9A9AA3] font-semibold flex items-center gap-1.5"><Car className="w-3 h-3" /> Vehicle</dt><dd className="mt-0.5">{person.vehicle ?? "None assigned"}</dd></div>
      </dl>
      </>)}
    </aside>
  ) : null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Messages" className="fixed inset-0 z-50 flex flex-col bg-[#0B0B0D]">
      {/* Dark band above the window; the close button lives here, outside the modal. */}
      <div className="shrink-0 h-12 md:h-14 flex items-center justify-end px-3 md:px-5" onClick={onClose}>
        <button aria-label="Close messages" onClick={onClose}
          className="w-11 h-11 grid place-items-center rounded-full text-white/80 hover:text-white hover:bg-white/10">
          <X className="w-6 h-6" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <div className="h-full min-h-0 rounded-t-2xl overflow-hidden bg-white shadow-2xl flex flex-col">
          <div className={`flex-1 min-h-0 grid grid-cols-1 ${infoPane && showInfo ? "md:grid-cols-[300px_1fr] xl:grid-cols-[320px_1fr_300px]" : "md:grid-cols-[300px_1fr] xl:grid-cols-[320px_1fr]"}`}>
            {listPane}
            {centerPane}
            {infoPane}
          </div>
        </div>
      </div>
    </div>
  );
}
