/**
 * Quo real-time events → lead activity log + FLEET (Automation Blueprint).
 *
 * Lines accepted for inbound events: QUO_INBOUND_NUMBER_IDS, comma-separated.
 * Each entry is a known Quo phone-number id (PNcX8a0PLJ, PNrZULvFMn) or
 * "PNid|+1XXXXXXXXXX|Label" for another line. Default: both known lines.
 * This list is separate from QUO_FROM_NUMBERS, which only narrows sending.
 *
 * Every quo_events row and every FLEET forward carries the line's E.164
 * number, Quo phoneNumberId and label.
 */
import { enqueueFleetEvent, type FleetEvent } from "@/lib/fleet-webhook.server";
import { toE164 } from "@/lib/sms.server";

type Env = Record<string, string | undefined>;
export type QuoLine = { id: string; e164: string; label: string };

export const QUO_INBOUND_DEFAULT_LINES: QuoLine[] = [
  { id: "PNcX8a0PLJ", e164: "+18132124174", label: "Primary 813" },
  { id: "PNrZULvFMn", e164: "+18888338280", label: "REAL Rentals 888" },
];

export function quoInboundLines(env: Env = process.env as Env): QuoLine[] {
  const raw = String(env.QUO_INBOUND_NUMBER_IDS ?? "").trim();
  if (!raw) return QUO_INBOUND_DEFAULT_LINES;
  const out: QuoLine[] = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [id, num, ...label] = part.split("|").map((s) => s.trim());
    const known = QUO_INBOUND_DEFAULT_LINES.find((l) => l.id === id);
    if (known && !num) out.push(known);
    else {
      const e164 = toE164(num);
      if (/^PN[A-Za-z0-9]+$/.test(id) && e164) out.push({ id, e164, label: label.join("|") || known?.label || e164 });
    }
  }
  return out;
}

export function quoInboundLineFor(phoneNumberId: unknown, env?: Env): QuoLine | null {
  if (typeof phoneNumberId !== "string" || !phoneNumberId) return null;
  return quoInboundLines(env).find((l) => l.id === phoneNumberId) ?? null;
}

const FLEET_EVENT_FOR: Record<string, FleetEvent> = {
  "message.received": "quo_message_received",
  "call.voicemail.completed": "quo_voicemail",
  "call.transcript.completed": "quo_transcript",
};
export function fleetEventForQuo(type: string): FleetEvent | null {
  if (FLEET_EVENT_FOR[type]) return FLEET_EVENT_FOR[type];
  if (type.startsWith("call.")) return "quo_call";
  return null;
}

function externalNumber(context: any, resource: any, direction: string | null, line: QuoLine): string | null {
  const cands: unknown[] = [];
  if (context?.senderIdentifier) cands.push(context.senderIdentifier);
  const ext = context?.participants?.external;
  if (Array.isArray(ext)) for (const p of ext) cands.push(typeof p === "string" ? p : p?.identifier ?? p?.phoneNumber ?? p?.number);
  if (direction === "outgoing") cands.push(resource?.to); else cands.push(resource?.from);
  for (const r of Array.isArray(context?.recipientIdentifiers) ? context.recipientIdentifiers : []) cands.push(r);
  cands.push(resource?.to, resource?.from);
  for (const c of cands) {
    const e = toE164(typeof c === "string" ? c : null);
    if (e && e !== line.e164) return e;
  }
  return null;
}

export type NormalizedQuoEvent = {
  quo_event_id: string;
  event_type: string;
  quo_resource_id: string | null;
  call_id: string | null;
  conversation_id: string | null;
  phone_number_id: string;
  line_e164: string;
  line_label: string;
  direction: string | null;
  from_e164: string | null;
  to_e164: string | null;
  body: string | null;
  transcript: string | null;
  recording_url: string | null;
  voicemail_url: string | null;
  duration_seconds: number | null;
  occurred_at: string | null;
};

/** Stable id for idempotency: the Quo event id, else type + resource id. */
export function quoEventKey(event: any): string | null {
  if (typeof event?.id === "string" && event.id) return event.id;
  const r = event?.data?.resource ?? {};
  const rid = r.id ?? r.callId ?? r.voicemailId;
  return event?.type && rid ? `${event.type}:${rid}` : null;
}

export function normalizeQuoEvent(event: any, line: QuoLine): NormalizedQuoEvent | null {
  const key = quoEventKey(event);
  if (!key) return null;
  const type = String(event?.type ?? "");
  const r = event?.data?.resource ?? {};
  const c = event?.data?.context ?? {};
  const direction = typeof r.direction === "string" ? r.direction : type === "message.received" || type === "call.missed" ? "incoming" : null;
  const ext = externalNumber(c, r, direction, line);
  const outgoing = direction === "outgoing";
  const dialogue = Array.isArray(r.dialogue) ? r.dialogue : null;
  const transcript = dialogue
    ? dialogue.map((d: any) => `${d.identifier ?? d.userId ?? "?"}: ${String(d.content ?? "").trim()}`).join("\n")
    : typeof r.transcript === "string" ? r.transcript : null;
  const rec = Array.isArray(r.recordings) ? r.recordings.find((x: any) => x?.url)?.url ?? null : null;
  const callId = typeof r.callId === "string" ? r.callId : type.startsWith("call.") && typeof r.id === "string" ? r.id : null;
  const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  return {
    quo_event_id: key,
    event_type: type,
    quo_resource_id: typeof r.id === "string" ? r.id : typeof r.voicemailId === "string" ? r.voicemailId : null,
    call_id: callId,
    conversation_id: typeof c.conversationId === "string" ? c.conversationId : null,
    phone_number_id: line.id,
    line_e164: line.e164,
    line_label: line.label,
    direction,
    from_e164: outgoing ? line.e164 : ext,
    to_e164: outgoing ? ext : line.e164,
    body: type === "message.received" ? String(r.text ?? "") : null,
    transcript,
    recording_url: (typeof r.recordingUrl === "string" ? r.recordingUrl : null) ?? rec,
    voicemail_url: type === "call.voicemail.completed" && typeof r.recordingUrl === "string" ? r.recordingUrl : null,
    duration_seconds: Number.isFinite(Number(r.duration)) ? Math.round(Number(r.duration)) : null,
    occurred_at: iso(r.completedAt) ?? iso(r.createdAt) ?? iso(event?.createdAt),
  };
}

/** Newest non-deleted application whose primary or extra phone ends in the same 10 digits. */
export async function matchLeadByPhone(admin: any, e164: string | null): Promise<string | null> {
  const { matchLeadByPhone: match } = await import("@/lib/driver-contacts.server");
  return match(admin, e164);
}

export function fleetPayloadForQuo(ev: NormalizedQuoEvent, leadId: string | null, receivedAt: string) {
  return {
    event: fleetEventForQuo(ev.event_type),
    lead_id: leadId,
    line: { e164: ev.line_e164, phone_number_id: ev.phone_number_id, label: ev.line_label },
    direction: ev.direction,
    from: ev.from_e164,
    to: ev.to_e164,
    body: ev.body,
    transcript: ev.transcript,
    recording_url: ev.recording_url,
    voicemail_url: ev.voicemail_url,
    duration_seconds: ev.duration_seconds,
    occurred_at: ev.occurred_at,
    received_at: receivedAt,
    quo: { event_id: ev.quo_event_id, type: ev.event_type, resource_id: ev.quo_resource_id, call_id: ev.call_id, conversation_id: ev.conversation_id },
  };
}

/**
 * Log the event on the lead (quo_events) and queue the FLEET forward, both
 * idempotent on the Quo event id. Returns the delivery id to send now, if new.
 */
export async function recordQuoEvent(admin: any, event: any, line: QuoLine, nowIso: string): Promise<{ deliveryId: string | null; leadId: string | null; duplicate: boolean } | null> {
  const ev = normalizeQuoEvent(event, line);
  if (!ev) return null;
  const leadId = await matchLeadByPhone(admin, ev.direction === "outgoing" ? ev.to_e164 : ev.from_e164);
  const { data: ins, error } = await admin
    .from("quo_events")
    .upsert({ ...ev, application_id: leadId, raw: event ?? {} }, { onConflict: "quo_event_id", ignoreDuplicates: true })
    .select("id");
  if (error) console.error("[quo-events] log failed", error.message);
  const duplicate = !error && Array.isArray(ins) && ins.length === 0;
  const fleetEvent = fleetEventForQuo(ev.event_type);
  if (!fleetEvent) return { deliveryId: null, leadId, duplicate };
  const deliveryId = await enqueueFleetEvent(admin, {
    event_type: fleetEvent,
    dedupe_key: `quo:${ev.quo_event_id}`,
    application_id: leadId,
    quo_event_id: ev.quo_event_id,
    payload: fleetPayloadForQuo(ev, leadId, nowIso),
  });
  return { deliveryId, leadId, duplicate };
}
