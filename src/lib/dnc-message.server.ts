// Staff-session read of the inbound message to show on a DNC row.
//
// The signed-in client only, so RLS applies. dnc_list.phones and dnc_list.emails
// are not granted to authenticated and are never selected. A person is matched
// through the application, driver contact, or waitlist row staff can already
// read. This module does not write.
import {
  dncE164,
  dncLookupEmail,
  isInboundMessageKind,
  pickDncTrigger,
  type DncMsgCandidate,
  type DncMsgChannel,
  type DncTriggerMessage,
} from "@/lib/dnc-message";

type Sb = { from: (table: string) => any };

type DncRow = {
  id: string;
  application_id: string | null;
  waitlist_id: string | null;
  full_name: string | null;
  created_at: string | null;
};

type Person = {
  id: string;
  name: string;
  addedAt: string | null;
  applicationIds: string[];
  phones: string[];
  emails: string[];
};

const READ_CAP = 1000;

async function read(query: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<any[]> {
  try {
    const { data, error } = await query;
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** `.in` over a granted column. Empty lists are skipped. A full page means the cap was hit. */
async function inRows(
  sb: Sb,
  table: string,
  column: string,
  ids: string[],
  columns: string,
  refine: (query: any) => any,
): Promise<{ rows: any[]; capped: boolean }> {
  const rows: any[] = [];
  let capped = false;
  for (const part of chunks([...new Set(ids)], 80)) {
    if (!part.length) continue;
    const page = await read(refine(sb.from(table).select(columns).in(column, part)).limit(READ_CAP));
    if (page.length >= READ_CAP) capped = true;
    rows.push(...page);
  }
  return { rows, capped };
}

function channelOf(value: unknown): DncMsgChannel | null {
  return value === "sms" || value === "email" ? value : null;
}

function pushUnique(list: string[], value: string | null) {
  if (value && !list.includes(value)) list.push(value);
}

function addContact(person: Person, phone: unknown, email: unknown) {
  pushUnique(person.phones, dncE164(phone));
  pushUnique(person.emails, dncLookupEmail(email));
}

function keep(list: DncMsgCandidate[], row: DncMsgCandidate) {
  if (!list.some((item) => item.id === row.id)) list.push(row);
}

function matches(person: Person, applicationId: unknown, address: unknown): boolean {
  if (applicationId && person.applicationIds.includes(String(applicationId))) return true;
  const phone = dncE164(address);
  if (phone && person.phones.includes(phone)) return true;
  const email = dncLookupEmail(address);
  return !!email && person.emails.includes(email);
}

function beforeAdded(query: any, addedMax: string | undefined) {
  return addedMax ? query.lte("created_at", addedMax) : query;
}

async function preciseInbound(sb: Sb, person: Person): Promise<DncMsgCandidate[]> {
  const found: DncMsgCandidate[] = [];
  const added = person.addedAt;
  if (!added) return found;
  for (const applicationId of person.applicationIds) {
    const [msgs, quo, outs] = await Promise.all([
      read(
        sb.from("messages").select("id, body, channel, created_at")
          .eq("application_id", applicationId).eq("direction", "inbound")
          .lte("created_at", added).order("created_at", { ascending: false }).limit(1),
      ),
      read(
        sb.from("quo_events").select("id, body, occurred_at, created_at")
          .eq("application_id", applicationId).eq("event_type", "message.received")
          .lte("created_at", added).order("created_at", { ascending: false }).limit(1),
      ),
      read(
        sb.from("outbound_messages").select("id, body, channel, kind, created_at, sent_at, subject")
          .eq("application_id", applicationId).like("kind", "inbound%")
          .lte("created_at", added).order("created_at", { ascending: false }).limit(1),
      ),
    ]);
    for (const row of msgs) {
      const channel = channelOf(row.channel);
      if (channel && row.created_at) keep(found, { id: `messages:${row.id}`, channel, body: String(row.body ?? ""), at: row.created_at });
    }
    for (const row of quo) {
      const at = row.occurred_at || row.created_at;
      if (at) keep(found, { id: `quo:${row.id}`, channel: "sms", body: String(row.body ?? ""), at });
    }
    for (const row of outs) {
      const channel = channelOf(row.channel);
      const at = row.sent_at || row.created_at;
      if (channel && at) keep(found, { id: `outbound:${row.id}`, channel, body: String(row.body ?? row.subject ?? ""), at });
    }
  }
  for (const phone of person.phones) {
    const [quo, outs] = await Promise.all([
      read(
        sb.from("quo_events").select("id, body, occurred_at, created_at")
          .eq("from_e164", phone).eq("event_type", "message.received")
          .lte("created_at", added).order("created_at", { ascending: false }).limit(1),
      ),
      read(
        sb.from("outbound_messages").select("id, body, channel, kind, created_at, sent_at, subject")
          .eq("to_address", phone).like("kind", "inbound%")
          .lte("created_at", added).order("created_at", { ascending: false }).limit(1),
      ),
    ]);
    for (const row of quo) {
      const at = row.occurred_at || row.created_at;
      if (at) keep(found, { id: `quo:${row.id}`, channel: "sms", body: String(row.body ?? ""), at });
    }
    for (const row of outs) {
      const channel = channelOf(row.channel);
      const at = row.sent_at || row.created_at;
      if (channel && at) keep(found, { id: `outbound:${row.id}`, channel, body: String(row.body ?? row.subject ?? ""), at });
    }
  }
  return found;
}

/**
 * One result per requested DNC id. Null means this staff session could not see
 * an inbound text or email on or before Added. Unreadable ids are null as well.
 */
export async function loadDncTriggerMessages(
  sb: Sb,
  ids: string[],
): Promise<Record<string, DncTriggerMessage | null>> {
  const out: Record<string, DncTriggerMessage | null> = {};
  for (const id of ids) out[id] = null;
  if (!ids.length) return out;

  const dnc = await inRows(sb, "dnc_list", "id", ids, "id, application_id, waitlist_id, full_name, created_at", (q) => q);
  const people = new Map<string, Person>();
  for (const row of dnc.rows as DncRow[]) {
    people.set(row.id, {
      id: row.id,
      name: row.full_name ?? "",
      addedAt: row.created_at,
      applicationIds: row.application_id ? [row.application_id] : [],
      phones: [],
      emails: [],
    });
  }

  const waitlistIds = (dnc.rows as DncRow[]).map((row) => row.waitlist_id).filter((id): id is string => !!id);
  const waitlist = await inRows(
    sb, "waitlist", "id", waitlistIds,
    "id, full_name, phone, email, promoted_application_id",
    (q) => q,
  );
  const waitlistById = new Map(waitlist.rows.map((row) => [String(row.id), row]));
  for (const row of dnc.rows as DncRow[]) {
    const person = people.get(row.id);
    const signup = row.waitlist_id ? waitlistById.get(row.waitlist_id) : undefined;
    if (!person || !signup) continue;
    if (!person.name && signup.full_name) person.name = String(signup.full_name);
    addContact(person, signup.phone, signup.email);
    if (signup.promoted_application_id) pushUnique(person.applicationIds, String(signup.promoted_application_id));
  }

  const applicationIds = [...new Set([...people.values()].flatMap((person) => person.applicationIds))];
  const [apps, contacts] = await Promise.all([
    inRows(sb, "applications", "id", applicationIds, "id, full_name, phone, email", (q) => q),
    inRows(sb, "driver_contacts", "application_id", applicationIds, "application_id, kind, value", (q) => q),
  ]);
  const appById = new Map(apps.rows.map((row) => [String(row.id), row]));
  for (const person of people.values()) {
    for (const applicationId of person.applicationIds) {
      const app = appById.get(applicationId);
      if (!app) continue;
      if (!person.name && app.full_name) person.name = String(app.full_name);
      addContact(person, app.phone, app.email);
    }
    for (const contact of contacts.rows) {
      if (!person.applicationIds.includes(String(contact.application_id))) continue;
      if (contact.kind === "phone") addContact(person, contact.value, null);
      if (contact.kind === "email") addContact(person, null, contact.value);
    }
  }

  const addedMax = (dnc.rows as DncRow[]).map((row) => row.created_at).filter((value): value is string => !!value).sort().at(-1);
  const phones = [...new Set([...people.values()].flatMap((person) => person.phones))];
  const addresses = [...phones, ...new Set([...people.values()].flatMap((person) => person.emails))];
  const [messages, quoByApp, quoByPhone, outboundByApp, outboundByAddress] = await Promise.all([
    inRows(sb, "messages", "application_id", applicationIds, "id, application_id, body, channel, direction, created_at, to_address", (q) =>
      beforeAdded(q, addedMax).order("created_at", { ascending: false })),
    inRows(sb, "quo_events", "application_id", applicationIds, "id, application_id, body, from_e164, occurred_at, created_at", (q) =>
      beforeAdded(q.eq("event_type", "message.received"), addedMax).order("created_at", { ascending: false })),
    inRows(sb, "quo_events", "from_e164", phones, "id, application_id, body, from_e164, occurred_at, created_at", (q) =>
      beforeAdded(q.eq("event_type", "message.received"), addedMax).order("created_at", { ascending: false })),
    inRows(sb, "outbound_messages", "application_id", applicationIds, "id, application_id, body, channel, kind, to_address, created_at, sent_at, status, subject", (q) =>
      beforeAdded(q, addedMax).order("created_at", { ascending: false })),
    inRows(sb, "outbound_messages", "to_address", addresses, "id, application_id, body, channel, kind, to_address, created_at, sent_at, status, subject", (q) =>
      beforeAdded(q, addedMax).order("created_at", { ascending: false })),
  ]);
  const capped = [messages, quoByApp, quoByPhone, outboundByApp, outboundByAddress].some((page) => page.capped);
  const quo = [...quoByApp.rows, ...quoByPhone.rows];
  const logged = [...outboundByApp.rows, ...outboundByAddress.rows];

  const pending: Array<{ person: Person; sent: DncMsgCandidate[] }> = [];
  for (const person of people.values()) {
    const inbound: DncMsgCandidate[] = [];
    const sent: DncMsgCandidate[] = [];
    for (const row of messages.rows) {
      if (!matches(person, row.application_id, row.to_address)) continue;
      const channel = channelOf(row.channel);
      if (!channel || !row.created_at) continue;
      const item = { id: `messages:${row.id}`, channel, body: String(row.body ?? ""), at: row.created_at };
      if (row.direction === "inbound") keep(inbound, item);
      else if (row.direction === "outbound") keep(sent, item);
    }
    for (const row of quo) {
      if (!matches(person, row.application_id, row.from_e164)) continue;
      const at = row.occurred_at || row.created_at;
      if (at) keep(inbound, { id: `quo:${row.id}`, channel: "sms", body: String(row.body ?? ""), at });
    }
    for (const row of logged) {
      if (!matches(person, row.application_id, row.to_address)) continue;
      const channel = channelOf(row.channel);
      const at = row.sent_at || row.created_at;
      if (!channel || !at) continue;
      const inboundKind = isInboundMessageKind(row.kind);
      if (!inboundKind && row.status !== "sent" && row.status !== "queued") continue;
      const item = { id: `outbound:${row.id}`, channel, body: String(row.body ?? row.subject ?? ""), at };
      keep(inboundKind ? inbound : sent, item);
    }
    // A capped page can hide an older inbound. Ask again, one row, only for those misses.
    if (capped && inbound.length === 0 && (person.applicationIds.length > 0 || person.phones.length > 0)) {
      pending.push({ person, sent });
    } else {
      out[person.id] = pickDncTrigger(person.addedAt, person.name, inbound, sent);
    }
  }

  for (const group of chunks(pending, 6)) {
    await Promise.all(group.map(async ({ person, sent }) => {
      const inbound = await preciseInbound(sb, person);
      out[person.id] = pickDncTrigger(person.addedAt, person.name, inbound, sent);
    }));
  }
  return out;
}
