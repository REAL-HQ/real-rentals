import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { MoreVertical, PhoneOff } from "lucide-react";
import { getDncTriggerMessages, listDnc, resolveDncProfile } from "@/lib/dnc.functions";
import { DNC_LIST_TITLE, REMOVE_FROM_DNC_LABEL, dncMatchesSearch, type DncEntry } from "@/lib/dnc";
import { dncAddedByDisplay, type DncNameSource } from "@/lib/dnc-added-by";
import {
  DNC_NO_MESSAGE_LABEL,
  DNC_TRIGGER_NOTE,
  dncChannelLabel,
  type DncTriggerMessage,
} from "@/lib/dnc-message";
import { fmtDate, fmtDateTime } from "@/lib/date-format";
import { displayPersonName } from "@/lib/display-normalize";
import { formatPhoneForDisplay } from "@/lib/us-phone";
import { AdminTableScroll } from "./AdminTableScroll";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdminToolbar, TOOLBAR } from "./AdminToolbar";
import { EmptyState } from "./ui";
import { DNC_CHANGED_EVENT } from "./DncGuard";
import { DncActionDialog } from "./DncControls";
import { ModalBody, ModalButton, ModalFooter, ModalHeader, ModalShell } from "./modal";

type View = "active" | "removed";

type WaitlistDetail = {
  phone: string | null;
  email: string | null;
  signedUp: string | null;
};

export type DncPreview = {
  entries: DncEntry[];
  messages: Record<string, DncTriggerMessage | null>;
  openMessageId?: string | null;
  openDetail?: boolean;
  /** Opens this row's options menu in a static fixture. */
  openMenuId?: string | null;
  nameSources?: DncNameSource[];
};

/**
 * Back office → DNC. Everyone on the internal Do Not Contact list: name,
 * reason, the inbound message that led here, who added them and when, with search.
 * Manager / Owner can remove an entry (reason + confirmation); removed entries
 * stay visible under Removed.
 */
export function DncPanel({ canRemove, preview }: { canRemove: boolean; preview?: DncPreview }) {
  const navigate = useNavigate();
  const load = useServerFn(listDnc);
  const loadMessages = useServerFn(getDncTriggerMessages);
  const resolveOpen = useServerFn(resolveDncProfile);
  const [entries, setEntries] = useState<DncEntry[] | null>(preview?.entries ?? null);
  const [messages, setMessages] = useState<Record<string, DncTriggerMessage | null> | null>(
    preview ? preview.messages : null,
  );
  const [installed, setInstalled] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("active");
  const [removing, setRemoving] = useState<DncEntry | null>(null);
  const [messageId, setMessageId] = useState<string | null>(preview?.openMessageId ?? null);
  const [menuId, setMenuId] = useState<string | null>(preview?.openMenuId ?? null);
  const [detail, setDetail] = useState<{ entry: DncEntry; extra: WaitlistDetail | null } | null>(
    preview?.openDetail && preview.entries[0] ? { entry: preview.entries[0], extra: null } : null,
  );
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [nameSources, setNameSources] = useState<DncNameSource[]>(preview?.nameSources ?? []);

  const refresh = useCallback(() => {
    if (preview) return;
    load()
      .then((r) => {
        setInstalled(r.installed);
        setEntries(r.entries);
        setNameSources(r.nameSources ?? []);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [load, preview]);

  useEffect(() => {
    if (preview) return;
    refresh();
    window.addEventListener(DNC_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(DNC_CHANGED_EVENT, refresh);
  }, [refresh, preview]);

  useEffect(() => {
    if (preview || !entries?.length) {
      if (!preview && entries && entries.length === 0) setMessages({});
      return;
    }
    let cancel = false;
    const ids = entries.map((entry) => entry.id);
    void (async () => {
      const next: Record<string, DncTriggerMessage | null> = {};
      for (let i = 0; i < ids.length; i += 100) {
        const slice = ids.slice(i, i + 100);
        const result = await loadMessages({ data: { ids: slice } });
        Object.assign(next, result.messages);
      }
      if (!cancel) setMessages(next);
    })().catch(() => {
      if (!cancel) setMessages({});
    });
    return () => {
      cancel = true;
    };
  }, [entries, loadMessages, preview]);

  const active = useMemo(() => (entries ?? []).filter((e) => !e.removedAt), [entries]);
  const removed = useMemo(() => (entries ?? []).filter((e) => e.removedAt), [entries]);
  const shown = useMemo(
    () => (view === "active" ? active : removed).filter((e) => dncMatchesSearch(e, q)),
    [view, active, removed, q],
  );
  const columns = view === "removed" ? 7 : 6;

  function openProfile(applicationId: string) {
    void navigate({ to: "/admin", search: { tab: "drivers", id: applicationId } });
  }

  async function openPerson(entry: DncEntry) {
    if (entry.applicationId) {
      openProfile(entry.applicationId);
      return;
    }
    if (entry.waitlistId && !preview) {
      setOpeningId(entry.id);
      try {
        const resolved = await resolveOpen({ data: { waitlistId: entry.waitlistId } });
        if (resolved.applicationId) {
          openProfile(resolved.applicationId);
          return;
        }
        setDetail({
          entry,
          extra: { phone: resolved.phone, email: resolved.email, signedUp: resolved.signedUp },
        });
      } catch {
        setDetail({ entry, extra: null });
      } finally {
        setOpeningId(null);
      }
      return;
    }
    setDetail({ entry, extra: null });
  }

  const openMessage = messageId ? (messages?.[messageId] ?? null) : null;
  const openMessageEntry = messageId ? (entries ?? []).find((entry) => entry.id === messageId) ?? null : null;

  return (
    <div data-testid="dnc-panel" className="min-w-0">
      <AdminToolbar
        compact
        search={
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Name, Reason Or Staff"
            aria-label="Search DNC List"
            className={TOOLBAR.search}
            data-testid="dnc-search"
          />
        }
        filters={
          <div className={TOOLBAR.segmented} role="tablist" aria-label="DNC View">
            {(["active", "removed"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`${TOOLBAR.segment} ${view === v ? "bg-[#F4F4F6] font-semibold text-[#111114]" : "text-[#55555E]"}`}
              >
                {v === "active" ? `On List (${active.length})` : `Removed (${removed.length})`}
              </button>
            ))}
          </div>
        }
      />
      {!installed ? (
        <EmptyState
          icon={<PhoneOff className="h-5 w-5" />}
          title="DNC List Not Enabled Yet"
          hint="The internal_dnc_list migration has not been applied to this database."
        />
      ) : failed ? (
        <EmptyState title="Could Not Load The DNC List" hint="Refresh the page to try again." />
      ) : (
        <AdminTableScroll className="rounded-lg border border-border bg-white">
          <table className="w-full text-sm" aria-label={DNC_LIST_TITLE}>
            <thead className="bg-soft text-[11px] tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Name</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Reason</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Message</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Added By</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Added</th>
                {view === "removed" ? (
                  <th className="text-left font-medium px-4 py-2.5 border-b border-border">Removed</th>
                ) : null}
                <th className="px-4 py-2.5 border-b border-border"></th>
              </tr>
            </thead>
            <tbody>
              {entries == null ? (
                <tr>
                  <td colSpan={columns} className="p-4 text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={columns} className="p-4">
                    <EmptyState
                      title={
                        q
                          ? "No Matches"
                          : view === "active"
                            ? "No One On The DNC List"
                            : "No Removed Entries"
                      }
                      hint={
                        view === "active" && !q
                          ? "Use Move To DNC on a driver or waitlist profile."
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                shown.map((e) => {
                  const name = e.fullName ? displayPersonName(e.fullName) : "Unnamed";
                  const message = messages ? messages[e.id] ?? null : undefined;
                  return (
                    <tr
                      key={e.id}
                      data-testid="dnc-row"
                      className="border-b border-border last:border-0 align-top"
                    >
                      <td className="px-4 py-2.5 font-medium">
                        <button
                          type="button"
                          className="text-left text-[#111114] underline decoration-[#C4C4CB] underline-offset-2 hover:decoration-[#111114]"
                          onClick={() => void openPerson(e)}
                          disabled={openingId === e.id}
                          data-testid="dnc-open-person"
                          title="Open Profile"
                        >
                          {name}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 min-w-[12rem] max-w-md whitespace-pre-wrap break-words">
                        {e.reason}
                      </td>
                      <td className="px-4 py-2.5 max-w-xs text-[#55555E]">
                        {message === undefined ? (
                          "…"
                        ) : message ? (
                          <div>
                            <button
                              type="button"
                              className="block max-w-full cursor-pointer truncate text-left text-[#111114] hover:underline focus-visible:underline"
                              title={message.body}
                              onClick={() => setMessageId(e.id)}
                              data-testid="dnc-open-message"
                            >
                              {message.body}
                            </button>
                            <div className="text-[11px] text-[#9A9AA3]">{message.label}</div>
                          </div>
                        ) : (
                          <span data-testid="dnc-no-message">{DNC_NO_MESSAGE_LABEL}</span>
                        )}
                      </td>
                      <td
                        className="px-4 py-2.5 whitespace-nowrap text-muted-foreground"
                        title={e.addedBy || undefined}
                        data-testid="dnc-added-by"
                      >
                        {dncAddedByDisplay(e.addedBy, nameSources, e.addedByUserId)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {e.createdAt ? fmtDate(e.createdAt) : "—"}
                      </td>
                      {view === "removed" ? (
                        <td className="px-4 py-2.5 text-muted-foreground">
                          <div className="whitespace-nowrap">
                            {e.removedAt ? fmtDate(e.removedAt) : "—"}
                          </div>
                          <div className="text-[11px]">{e.removedBy}</div>
                          {e.removalReason ? (
                            <div className="text-[11px] whitespace-pre-wrap">{e.removalReason}</div>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        {canRemove && !e.removedAt ? (
                          <DropdownMenu
                            open={menuId === e.id}
                            onOpenChange={(open) => setMenuId(open ? e.id : null)}
                          >
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label="Row Options"
                                data-testid="dnc-row-options"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-soft hover:text-foreground"
                              >
                                <MoreVertical aria-hidden="true" className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 bg-white">
                              <DropdownMenuItem
                                data-testid="dnc-row-remove"
                                className="text-real-red focus:text-real-red"
                                onSelect={() => setRemoving(e)}
                              >
                                {REMOVE_FROM_DNC_LABEL}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
      {removing ? (
        <DncActionDialog
          mode="remove"
          target={{
            applicationId: removing.applicationId ?? undefined,
            waitlistId: removing.waitlistId ?? undefined,
            name: removing.fullName,
          }}
          entryId={removing.id}
          onClose={() => setRemoving(null)}
        />
      ) : null}
      {messageId && openMessage && openMessageEntry ? (
        <DncMessageDialog
          name={openMessageEntry.fullName ? displayPersonName(openMessageEntry.fullName) : "Unnamed"}
          message={openMessage}
          onClose={() => setMessageId(null)}
        />
      ) : null}
      {detail ? (
        <DncRecordDialog
          entry={detail.entry}
          extra={detail.extra}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </div>
  );
}

function DncMessageDialog({
  name,
  message,
  onClose,
}: {
  name: string;
  message: DncTriggerMessage;
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose} size="md" label="View Message">
      <ModalHeader title="View Message" subtitle={name} onClose={onClose} />
      <ModalBody className="space-y-4">
        <p className="text-sm text-[#55555E]">
          <span className="font-semibold text-[#111114]">{message.label}.</span> {DNC_TRIGGER_NOTE}
        </p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-semibold text-[#9A9AA3]">Sender</dt>
            <dd className="text-sm text-[#111114]">{message.sender}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold text-[#9A9AA3]">Channel</dt>
            <dd className="text-sm text-[#111114]">{dncChannelLabel(message.channel)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold text-[#9A9AA3]">Sent</dt>
            <dd className="text-sm text-[#111114]">{fmtDateTime(message.at)}</dd>
          </div>
        </dl>
        <div>
          <div className="mb-1 text-[11px] font-semibold text-[#9A9AA3]">Message</div>
          <div className="whitespace-pre-wrap break-words rounded-md bg-[#F4F4F6] px-3 py-2 text-sm text-[#111114]">
            {message.body}
          </div>
        </div>
        {message.repliedTo ? (
          <div>
            <div className="mb-1 text-[11px] font-semibold text-[#9A9AA3]">Replied To</div>
            <div className="mb-1 text-[12px] text-[#55555E]">
              {dncChannelLabel(message.repliedTo.channel)} · {fmtDateTime(message.repliedTo.at)}
            </div>
            <div className="whitespace-pre-wrap break-words rounded-md bg-[#F4F4F6] px-3 py-2 text-sm text-[#111114]">
              {message.repliedTo.body}
            </div>
          </div>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Close</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

function DncRecordDialog({
  entry,
  extra,
  onClose,
}: {
  entry: DncEntry;
  extra: WaitlistDetail | null;
  onClose: () => void;
}) {
  const name = entry.fullName ? displayPersonName(entry.fullName) : "Unnamed";
  const phone = extra?.phone ? formatPhoneForDisplay(extra.phone) : "";
  return (
    <ModalShell onClose={onClose} size="md" label="DNC Record">
      <ModalHeader title={name} subtitle={entry.personTypeLabel} onClose={onClose} />
      <ModalBody className="space-y-4">
        <p className="text-sm text-[#55555E]">No driver profile is linked to this DNC entry.</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type" value={entry.personTypeLabel} />
          <Field label="Added" value={entry.createdAt ? fmtDate(entry.createdAt) : "—"} />
          <Field label="Added By" value={entry.addedBy || "—"} />
          {entry.removedAt ? <Field label="Removed" value={fmtDate(entry.removedAt)} /> : null}
          {phone ? <Field label="Phone" value={phone} /> : null}
          {extra?.email ? <Field label="Email" value={extra.email} /> : null}
          {extra?.signedUp ? <Field label="Signed Up" value={fmtDate(extra.signedUp)} /> : null}
        </dl>
        <div>
          <div className="mb-1 text-[11px] font-semibold text-[#9A9AA3]">Reason</div>
          <div className="whitespace-pre-wrap break-words rounded-md bg-[#F4F4F6] px-3 py-2 text-sm text-[#111114]">
            {entry.reason}
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Close</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold text-[#9A9AA3]">{label}</dt>
      <dd className="text-sm text-[#111114] break-words">{value}</dd>
    </div>
  );
}
