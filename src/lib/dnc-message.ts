// How a DNC row relates to the inbound text or email that led to it.
//
// public.dnc_list has no message id (see 20261127170000_internal_dnc_list.sql).
// Until one is stored, the row shows the latest inbound on or before Added,
// and the label says so. This file is pure: the staff read lives in
// dnc-message.server.ts and only returns rows the staff session can already see.

export const DNC_TRIGGER_LABEL = "Most Recent Inbound On Or Before Added";
export const DNC_NO_MESSAGE_LABEL = "No Message Found";
export const DNC_TRIGGER_NOTE =
  "The DNC record does not store a message id, so this is the latest inbound text or email from this person on or before they were added.";

export type DncMsgChannel = "sms" | "email";

export type DncMsgCandidate = {
  id: string;
  channel: DncMsgChannel;
  body: string;
  at: string;
};

export type DncRepliedTo = {
  channel: DncMsgChannel;
  body: string;
  at: string;
};

export type DncTriggerMessage = {
  /** Always true: the DNC row does not point at a message. */
  inferred: true;
  label: typeof DNC_TRIGGER_LABEL;
  id: string;
  channel: DncMsgChannel;
  body: string;
  sender: string;
  at: string;
  repliedTo: DncRepliedTo | null;
};

export function dncChannelLabel(channel: DncMsgChannel): "Text" | "Email" {
  return channel === "email" ? "Email" : "Text";
}

/** US numbers to E.164. Same 10/11-digit rule as toE164, without pulling the SMS client into the browser. */
export function dncE164(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Lowercased email safe to put in a PostgREST `in` filter. */
export function dncLookupEmail(raw: unknown): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@,()]+@[^\s@,()]+$/.test(e) ? e : null;
}

export function isInboundMessageKind(kind: string | null | undefined): boolean {
  return String(kind ?? "").startsWith("inbound");
}

function time(value: string): number {
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function latest(rows: DncMsgCandidate[], bound: number, inclusive: boolean): DncMsgCandidate | null {
  let best: DncMsgCandidate | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const at = time(row.at);
    if (!Number.isFinite(at) || (inclusive ? at > bound : at >= bound)) continue;
    if (!best || at > bestAt || (at === bestAt && row.id < best.id)) {
      best = row;
      bestAt = at;
    }
  }
  return best;
}

/**
 * The inbound to show for one DNC row, plus the outbound it most likely answered.
 * Inbound at or before Added wins. A same-channel outbound strictly before that
 * inbound is the reply target; otherwise the latest outbound of either channel.
 */
export function pickDncTrigger(
  addedAt: string | null,
  sender: string,
  inbound: DncMsgCandidate[],
  outbound: DncMsgCandidate[],
): DncTriggerMessage | null {
  const added = time(addedAt ?? "");
  if (!Number.isFinite(added)) return null;
  const hit = latest(inbound, added, true);
  if (!hit) return null;
  const hitAt = time(hit.at);
  const before = outbound.filter((row) => {
    const at = time(row.at);
    return Number.isFinite(at) && at < hitAt;
  });
  const same = before.filter((row) => row.channel === hit.channel);
  const reply = latest(same.length ? same : before, hitAt, false);
  const text = (body: string) => body.trim() || "Empty Message";
  return {
    inferred: true,
    label: DNC_TRIGGER_LABEL,
    id: hit.id,
    channel: hit.channel,
    body: text(hit.body),
    sender: sender.trim() || "This Person",
    at: hit.at,
    repliedTo: reply ? { channel: reply.channel, body: text(reply.body), at: reply.at } : null,
  };
}
