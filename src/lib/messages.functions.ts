import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";

// Unified, channel-aware staff inbox. A conversation belongs to a PERSON
// (an application row); each message carries its own channel. Sending goes
// only through the canonical senders (email.server sendEmail, sms.server
// sendSms) — never a parallel provider path — and a message's delivery state
// is only ever what the provider reported, never assumed.

export type Channel = "sms" | "email" | "internal" | "system";
export type ChannelAvailability = { available: boolean; reason: string | null; address: string | null };

export type ConversationSummary = {
  applicationId: string;
  name: string;
  status: string | null;
  lastBody: string;
  lastChannel: Channel;
  lastAt: string;
  unread: number;
};

export type ThreadMessage = {
  id: string;
  body: string;
  subject: string | null;
  channel: Channel;
  direction: "inbound" | "outbound" | "internal";
  deliveryState: string | null;
  deliveryError: string | null;
  toAddress: string | null;
  createdAt: string;
};

export type PersonInfo = {
  applicationId: string;
  name: string;
  status: string | null;
  phone: string | null;
  email: string | null;
  vehicle: string | null;
  email_channel: ChannelAvailability;
  sms_channel: ChannelAvailability;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function channelsFor(sb: any, app: { id: string; email: string | null; phone: string | null; sms_consent: boolean | null; sms_opt_out_at: string | null }) {
  const { toE164, isOptedOut } = await import("@/lib/sms.server");
  const email: ChannelAvailability = !app.email
    ? { available: false, reason: "No email address on file.", address: null }
    : !process.env.RESEND_API_KEY
      ? { available: false, reason: "Email sending is not configured.", address: app.email }
      : { available: true, reason: null, address: app.email };
  const e164 = toE164(app.phone);
  const twilio = !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && (!!process.env.TWILIO_FROM_NUMBER || !!process.env.TWILIO_MESSAGING_SERVICE_SID);
  let sms: ChannelAvailability;
  if (!e164) sms = { available: false, reason: "No valid mobile number on file.", address: null };
  else if (!twilio) sms = { available: false, reason: "Texting is not set up yet (no SMS provider connected).", address: e164 };
  else if (app.sms_opt_out_at || (await isOptedOut(sb, e164))) sms = { available: false, reason: "This person opted out of texts.", address: e164 };
  else if (!app.sms_consent) sms = { available: false, reason: "No text-message consent on file.", address: e164 };
  else sms = { available: true, reason: null, address: e164 };
  return { email, sms };
}

/** Effective state: email rows follow the webhook-tracked delivery record. */
function effectiveState(m: any, deliveries: Record<string, string>): string | null {
  if (m.email_delivery_id && deliveries[m.email_delivery_id]) return deliveries[m.email_delivery_id];
  return m.delivery_state ?? null;
}

export const listConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ conversations: ConversationSummary[]; unread: number }> => {
    await requireStaff(context.userId);
    const sb = await admin();
    const { data: rows, error } = await sb
      .from("messages")
      .select("application_id, body, channel, direction, read, created_at")
      .not("application_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    const by = new Map<string, any[]>();
    for (const r of rows ?? []) {
      const arr = by.get(r.application_id as string) ?? [];
      arr.push(r);
      by.set(r.application_id as string, arr);
    }
    const ids = [...by.keys()];
    const names: Record<string, { name: string; status: string | null }> = {};
    if (ids.length) {
      const { data: apps } = await sb.from("applications").select("id, full_name, email, status").in("id", ids);
      for (const a of apps ?? []) names[a.id] = { name: a.full_name || a.email || "Unnamed", status: a.status };
    }
    let unread = 0;
    const conversations = ids.map((id) => {
      const items = by.get(id)!;
      const latest = items[0];
      const u = items.filter((m) => m.direction === "inbound" && !m.read).length;
      unread += u;
      return {
        applicationId: id,
        name: names[id]?.name ?? "Unknown person",
        status: names[id]?.status ?? null,
        lastBody: latest.body,
        lastChannel: latest.channel,
        lastAt: latest.created_at,
        unread: u,
      };
    });
    return { conversations, unread };
  });

export const getConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ person: PersonInfo; messages: ThreadMessage[] }> => {
    await requireStaff(context.userId);
    const sb = await admin();
    const { data: app, error } = await sb
      .from("applications")
      .select("id, full_name, email, phone, status, vehicle_id, sms_consent, sms_opt_out_at")
      .eq("id", data.applicationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!app) throw new Error("Person not found.");
    let vehicle: string | null = null;
    if (app.vehicle_id) {
      const { data: v } = await sb.from("vehicles").select("unit_number, year, make, model").eq("id", app.vehicle_id).maybeSingle();
      if (v) vehicle = [v.unit_number, [v.year, v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    }
    const { email, sms } = await channelsFor(sb, app as any);
    const { data: msgs } = await sb
      .from("messages")
      .select("id, body, subject, channel, direction, delivery_state, delivery_error, email_delivery_id, to_address, created_at")
      .eq("application_id", data.applicationId)
      .order("created_at", { ascending: true })
      .limit(500);
    const dIds = (msgs ?? []).map((m: any) => m.email_delivery_id).filter(Boolean);
    const deliveries: Record<string, string> = {};
    if (dIds.length) {
      const { data: d } = await sb.from("email_deliveries").select("id, state").in("id", dIds);
      for (const x of d ?? []) deliveries[x.id] = x.state;
    }
    return {
      person: {
        applicationId: app.id,
        name: app.full_name || app.email || "Unnamed",
        status: app.status,
        phone: app.phone,
        email: app.email,
        vehicle,
        email_channel: email,
        sms_channel: sms,
      },
      messages: (msgs ?? []).map((m: any) => ({
        id: m.id,
        body: m.body,
        subject: m.subject,
        channel: m.channel,
        direction: m.direction,
        deliveryState: effectiveState(m, deliveries),
        deliveryError: m.delivery_error,
        toAddress: m.to_address,
        createdAt: m.created_at,
      })),
    };
  });

export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const sb = await admin();
    await sb.from("messages").update({ read: true }).eq("application_id", data.applicationId).eq("direction", "inbound").eq("read", false);
    return { ok: true };
  });

export const searchMessagePeople = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().trim().min(2).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const sb = await admin();
    const q = data.q.replace(/[%,()]/g, " ");
    const { data: rows } = await sb
      .from("applications")
      .select("id, full_name, email, phone, status")
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(10);
    return (rows ?? []).map((r: any) => ({ id: r.id as string, name: (r.full_name || r.email || "Unnamed") as string, status: r.status as string | null, hasEmail: !!r.email, hasPhone: !!r.phone }));
  });

function escapeHtml(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const sendStaffMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      applicationId: z.string().uuid(),
      channel: z.enum(["email", "sms"]),
      body: z.string().trim().min(1).max(4000),
      subject: z.string().trim().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; state: string; error?: string }> => {
    await requireStaff(context.userId);
    const sb = await admin();
    const { data: app } = await sb
      .from("applications")
      .select("id, full_name, email, phone, sms_consent, sms_opt_out_at")
      .eq("id", data.applicationId)
      .maybeSingle();
    if (!app) return { ok: false, state: "failed", error: "Person not found." };
    const ch = await channelsFor(sb, app as any);
    const avail = data.channel === "email" ? ch.email : ch.sms;
    if (!avail.available) return { ok: false, state: "skipped", error: avail.reason ?? "Channel unavailable." };

    const { data: row, error: insErr } = await sb
      .from("messages")
      .insert({
        thread_id: data.applicationId,
        application_id: data.applicationId,
        body: data.body,
        subject: data.channel === "email" ? (data.subject || "A message from REAL RENTALS") : null,
        kind: "admin",
        sender_id: context.userId,
        channel: data.channel,
        direction: "outbound",
        delivery_state: "sending",
        to_address: avail.address,
        read: true,
      } as any)
      .select("id")
      .single();
    if (insErr || !row) return { ok: false, state: "failed", error: insErr?.message ?? "Could not save message." };

    let state = "failed";
    let err: string | null = null;
    let deliveryId: string | null = null;
    if (data.channel === "email") {
      const { sendEmail } = await import("@/lib/email.server");
      const first = (app.full_name || "").split(/\s+/)[0];
      const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">${first ? `<p>Hi ${escapeHtml(first)},</p>` : ""}${escapeHtml(data.body).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}<p>— REAL RENTALS</p></div>`;
      const r = await sendEmail({ to: avail.address!, subject: data.subject || "A message from REAL RENTALS", html, track: { workflow: "staff_message" } });
      state = r.ok ? "accepted" : "failed";
      err = r.ok ? null : (r.error ?? "Send failed").slice(0, 500);
      deliveryId = r.deliveryId ?? null;
    } else {
      const { sendSms } = await import("@/lib/sms.server");
      const r = await sendSms({ to: avail.address!, body: data.body, kind: "staff_message", applicationId: data.applicationId });
      if (r.ok) state = "sent";
      else if ("skipped" in r && r.skipped) { state = "skipped"; err = r.reason; }
      else { state = "failed"; err = "error" in r ? r.error : "Send failed"; }
    }
    await sb.from("messages").update({ delivery_state: state, delivery_error: err, email_delivery_id: deliveryId } as any).eq("id", row.id);
    return { ok: state === "accepted" || state === "sent", state, error: err ?? undefined };
  });
