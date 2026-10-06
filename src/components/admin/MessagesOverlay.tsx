import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  X, Search, Plus, ArrowLeft, Info, Mail, MessageSquare, Send, Loader2, ExternalLink, Phone, Car, StickyNote,
} from "lucide-react";
import {
  listConversations, getConversation, markConversationRead, searchMessagePeople, sendStaffMessage,
  type ConversationSummary, type ThreadMessage, type PersonInfo,
} from "@/lib/messages.functions";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
}
function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
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
  const [thread, setThread] = useState<{ person: PersonInfo; messages: ThreadMessage[] } | null>(null);
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
    const q = query.trim().toLowerCase();
    if (q) l = l.filter((c) => c.name.toLowerCase().includes(q) || c.lastBody.toLowerCase().includes(q));
    return l;
  }, [convs, filter, query]);

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

  const listPane = (
    <aside className={`${mobile === "list" ? "flex" : "hidden"} md:flex flex-col min-h-0 border-r border-[#EDEDF0] bg-white`}>
      <div className="px-4 pt-4 pb-3 border-b border-[#EDEDF0]">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-[#111114]">Messages</h2>
          <button
            onClick={() => { setComposing(true); setPeopleQ(""); onSelect(null); setMobile("thread"); }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[#D03020] text-white text-[12px] font-semibold hover:bg-[#B5281A]"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.25} /> New Message
          </button>
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9A9AA3]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations"
            className="w-full h-10 pl-9 pr-3 text-[13px] rounded-lg bg-[#FAFAFB] border border-[#EDEDF0] focus:outline-none focus:border-[#C4C4CB]" />
        </div>
        <div className="mt-2 flex gap-1">
          {(["all", "unread"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`h-8 px-3 rounded-full text-[12px] font-medium ${filter === f ? "bg-[#111114] text-white" : "text-[#55555E] hover:bg-[#F4F4F6]"}`}>
              {f === "all" ? "All" : "Unread"}
            </button>
          ))}
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
                    className={`w-full text-left px-4 py-3 flex gap-3 border-b border-[#F4F4F6] min-h-[64px] ${active ? "bg-[#FAFAFB]" : "hover:bg-[#FAFAFB]"}`}>
                    <div className="w-9 h-9 rounded-full bg-[#F4F4F6] text-[#55555E] grid place-items-center text-[11px] font-semibold shrink-0">{initials(c.name)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13px] truncate ${c.unread ? "font-semibold" : "font-medium"} text-[#111114]`}>{c.name}</span>
                        <span className="ml-auto text-[11px] text-[#9A9AA3] tabular-nums shrink-0">{fmtWhen(c.lastAt)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Icon className="w-3 h-3 text-[#9A9AA3] shrink-0" />
                        <span className="text-[12px] text-[#55555E] truncate flex-1">{c.lastBody}</span>
                        {c.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#D03020] text-white text-[10px] font-semibold grid place-items-center">{c.unread}</span>}
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
    <section className={`${mobile === "thread" ? "flex" : "hidden"} md:flex flex-col min-h-0 bg-[#FAFAFB]`}>
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
          <header className="flex items-center gap-3 px-4 h-14 border-b border-[#EDEDF0] bg-white shrink-0">
            <button aria-label="Back to conversations" onClick={() => { onSelect(null); setMobile("list"); }} className="md:hidden w-11 h-11 -ml-2 grid place-items-center rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
            <div className="w-9 h-9 rounded-full bg-[#F4F4F6] text-[#55555E] grid place-items-center text-[12px] font-semibold shrink-0">{initials(person?.name ?? "?")}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold truncate">{person?.name ?? "Loading…"}</div>
              <div className="text-[11px] text-[#9A9AA3] truncate capitalize">{person?.status ?? ""}</div>
            </div>
            <button aria-label="Conversation info" onClick={() => { setShowInfo((v) => !v); setMobile("info"); }}
              className="w-11 h-11 grid place-items-center rounded-lg text-[#55555E] hover:bg-[#F4F4F6]"><Info className="w-5 h-5" /></button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            {loadingThread && !thread ? (
              <div className="text-[12px] text-[#9A9AA3]">Loading…</div>
            ) : groups.length === 0 ? (
              <div className="h-full grid place-items-center text-center text-[13px] text-[#9A9AA3]">No messages with {person?.name ?? "this person"} yet.</div>
            ) : (
              groups.map((g) => (
                <div key={g.day} className="mb-3">
                  <div className="my-3 flex items-center gap-3 text-[11px] text-[#9A9AA3]"><span className="h-px flex-1 bg-[#EDEDF0]" />{g.day}<span className="h-px flex-1 bg-[#EDEDF0]" /></div>
                  <div className="space-y-2">
                    {g.items.map((m) => {
                      const out = m.direction !== "inbound";
                      const Icon = CH_ICON[m.channel] ?? MessageSquare;
                      const bad = m.deliveryState && ["failed", "bounced", "complained", "skipped"].includes(m.deliveryState);
                      return (
                        <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${out ? "bg-[#111114] text-white rounded-br-sm" : "bg-white border border-[#EDEDF0] text-[#111114] rounded-bl-sm"}`}>
                            {m.subject && <div className={`text-[11px] font-semibold mb-0.5 ${out ? "text-white/70" : "text-[#55555E]"}`}>{m.subject}</div>}
                            <div className="whitespace-pre-wrap break-words">{m.body}</div>
                            <div className={`mt-1 flex items-center gap-1.5 text-[10px] ${out ? "text-white/60" : "text-[#9A9AA3]"}`}>
                              <Icon className="w-3 h-3" />
                              <span>{CH_LABEL[m.channel]}</span>
                              <span>· {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                              {out && m.deliveryState && <span className={bad ? "text-[#FF8A80]" : ""}>· {STATE_LABEL[m.deliveryState] ?? m.deliveryState}</span>}
                            </div>
                            {bad && m.deliveryError && <div className="mt-0.5 text-[10px] text-[#FF8A80]">{m.deliveryError}</div>}
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
            <footer className="shrink-0 border-t border-[#EDEDF0] bg-white p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              {noChannel ? (
                <p className="text-[12px] text-[#55555E] px-1 py-2">No delivery method is available for this person right now. {person.email_channel.reason} {person.sms_channel.reason}</p>
              ) : (
                <>
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-[11px] text-[#9A9AA3] mr-1">Send via</span>
                    {(["email", "sms"] as const).map((c) => {
                      const a = c === "email" ? person.email_channel : person.sms_channel;
                      return (
                        <button key={c} disabled={!a.available} onClick={() => setChannel(c)} title={a.reason ?? a.address ?? ""}
                          className={`h-8 px-3 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5 ${channel === c && a.available ? "bg-[#111114] text-white" : a.available ? "text-[#55555E] hover:bg-[#F4F4F6]" : "text-[#C4C4CB] cursor-not-allowed"}`}>
                          {c === "email" ? <Mail className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}{c === "email" ? "Email" : "Text"}
                        </button>
                      );
                    })}
                  </div>
                  {!chAvail?.available && <p className="text-[11px] text-[#9A9AA3] mb-2">{chAvail?.reason}</p>}
                  {(!person.sms_channel.available && person.sms_channel.reason) && channel === "email" && (
                    <p className="text-[11px] text-[#9A9AA3] mb-2">Text unavailable: {person.sms_channel.reason}</p>
                  )}
                  {channel === "email" && chAvail?.available && (
                    <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (optional)"
                      className="w-full h-9 mb-2 px-3 text-[13px] rounded-lg border border-[#EDEDF0] focus:outline-none focus:border-[#C4C4CB]" />
                  )}
                  <div className="flex items-end gap-2">
                    <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} disabled={!chAvail?.available}
                      placeholder={chAvail?.available ? `Write ${channel === "email" ? "an email" : "a text"} to ${person.name.split(" ")[0]}…` : "Choose an available delivery method"}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }}
                      className="flex-1 min-h-[44px] max-h-40 px-3 py-2.5 text-[13px] rounded-lg border border-[#EDEDF0] focus:outline-none focus:border-[#C4C4CB] resize-y" />
                    <button onClick={() => void submit()} disabled={sending || !body.trim() || !chAvail?.available}
                      className="h-11 px-4 rounded-lg bg-[#D03020] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
                    </button>
                  </div>
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
    <aside className={`${mobile === "info" ? "flex" : "hidden"} ${showInfo ? "md:flex" : "md:hidden"} flex-col min-h-0 border-l border-[#EDEDF0] bg-white overflow-y-auto`}>
      <div className="flex items-center gap-2 px-4 h-14 border-b border-[#EDEDF0] md:hidden">
        <button aria-label="Back to conversation" onClick={() => setMobile("thread")} className="w-11 h-11 -ml-2 grid place-items-center rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <div className="text-[14px] font-semibold">Info</div>
      </div>
      <div className="p-5 text-center border-b border-[#EDEDF0]">
        <div className="w-14 h-14 mx-auto rounded-full bg-[#F4F4F6] text-[#55555E] grid place-items-center text-[16px] font-semibold">{initials(person.name)}</div>
        <div className="mt-2 text-[15px] font-semibold">{person.name}</div>
        <div className="text-[12px] text-[#9A9AA3] capitalize">{person.status ?? "—"}</div>
        <Link to="/admin" search={{ tab: "drivers", id: person.applicationId }} onClick={onClose}
          className="mt-3 inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-[#EDEDF0] text-[12px] font-medium hover:bg-[#FAFAFB]">
          Open driver profile <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
      <dl className="p-5 space-y-4 text-[13px]">
        <div><dt className="text-[11px] uppercase tracking-wider text-[#9A9AA3] font-semibold flex items-center gap-1.5"><Phone className="w-3 h-3" /> Phone</dt><dd className="mt-0.5">{person.phone ?? "—"}</dd><dd className="text-[11px] text-[#9A9AA3]">{person.sms_channel.available ? "Text available" : person.sms_channel.reason}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wider text-[#9A9AA3] font-semibold flex items-center gap-1.5"><Mail className="w-3 h-3" /> Email</dt><dd className="mt-0.5 break-all">{person.email ?? "—"}</dd><dd className="text-[11px] text-[#9A9AA3]">{person.email_channel.available ? "Email available" : person.email_channel.reason}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wider text-[#9A9AA3] font-semibold flex items-center gap-1.5"><Car className="w-3 h-3" /> Vehicle</dt><dd className="mt-0.5">{person.vehicle ?? "None assigned"}</dd></div>
      </dl>
    </aside>
  ) : null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Messages" className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[#0B0B0D]/40" onClick={onClose} />
      <div className="absolute inset-0 md:inset-6 lg:inset-8 md:rounded-2xl overflow-hidden bg-white shadow-2xl flex flex-col">
        <button aria-label="Close messages" onClick={onClose}
          className="absolute top-2 right-2 md:top-3 md:right-3 z-10 w-11 h-11 grid place-items-center rounded-full bg-white/90 text-[#55555E] hover:bg-[#F4F4F6] hover:text-[#111114]">
          <X className="w-5 h-5" />
        </button>
        <div className={`flex-1 min-h-0 grid grid-cols-1 ${infoPane && showInfo ? "md:grid-cols-[300px_1fr] xl:grid-cols-[320px_1fr_300px]" : "md:grid-cols-[300px_1fr] xl:grid-cols-[320px_1fr]"}`}>
          {listPane}
          {centerPane}
          {infoPane && <div className="contents xl:contents [&>aside]:md:hidden [&>aside]:xl:flex">{infoPane}</div>}
        </div>
      </div>
    </div>
  );
}
