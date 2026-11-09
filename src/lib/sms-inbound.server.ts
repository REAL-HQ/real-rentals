// Provider-neutral handling of one inbound text (Twilio or Quo webhook).
//
// Callers verify the provider signature first, then hand over the sender,
// our number, the text and the provider's message id. Two compliance jobs:
//   1. STOP/START are honoured immediately and permanently.
//   2. A real reply cancels in-flight follow-ups (stop_on_reply) so a human
//      conversation is never talked over by an automated nudge.
import { classifyInboundSms } from "@/lib/sms.server";

export type InboundSmsArgs = {
  /** Sender, already E.164. */
  from: string;
  /** Our number that received it. */
  to: string | null;
  body: string;
  provider: "twilio" | "quo";
  providerMessageId: string | null;
};

export type InboundSmsOutcome = { intent: "stop" | "start" | "help" | "other"; reply?: string };

export async function processInboundSms(args: InboundSmsArgs): Promise<InboundSmsOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const from = args.from;
  const body = args.body;

  const intent = classifyInboundSms(body);

  // Log the inbound message so the team can see the conversation in the admin.
  await supabaseAdmin.from("outbound_messages").insert({
    channel: "sms",
    to_address: from,
    from_address: args.to ?? null,
    body,
    status: "sent",
    provider: args.provider,
    provider_message_id: args.providerMessageId ?? null,
    kind: `inbound_${intent}`,
    sent_at: new Date().toISOString(),
  });

  // Match the number back to applications so we can act on their record.
  const digits = from.replace(/^\+1/, "");
  const { data: apps } = await supabaseAdmin
    .from("applications")
    .select("id,phone")
    .ilike("phone", `%${digits.slice(-10)}%`)
    .limit(10);
  const appIds = (apps ?? []).map((a: any) => a.id as string);

  // Thread every inbound text into the staff Messages conversation for the
  // matched person (most recent application wins when duplicates exist).
  if (appIds.length) {
    const { data: newest } = await supabaseAdmin
      .from("applications").select("id").in("id", appIds)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (newest) {
      await supabaseAdmin.from("messages").insert({
        thread_id: newest.id, application_id: newest.id, body: body || "(empty message)",
        kind: "inbound", channel: "sms", direction: "inbound", delivery_state: "delivered",
        to_address: from, read: false,
      } as any);
    }
  }

  if (intent === "stop") {
    await supabaseAdmin
      .from("sms_opt_outs")
      .upsert({ phone: from, reason: "inbound STOP" }, { onConflict: "phone" });
    if (appIds.length) {
      await supabaseAdmin
        .from("applications")
        .update({ sms_opt_out_at: new Date().toISOString(), sms_consent: false })
        .in("id", appIds);
      await supabaseAdmin
        .from("automation_enrollments")
        .update({
          status: "cancelled",
          cancelled_reason: "recipient replied STOP",
          next_run_at: null,
        })
        .in("application_id", appIds)
        .eq("status", "active");
    }
    // The provider (Twilio Advanced Opt-Out / Quo) confirms STOP itself; stay silent.
    return { intent };
  }

  if (intent === "start") {
    await supabaseAdmin.from("sms_opt_outs").delete().eq("phone", from);
    if (appIds.length) {
      await supabaseAdmin
        .from("applications")
        .update({
          sms_opt_out_at: null,
          sms_consent: true,
          // Re-consent by texting START: recorded as its own source.
          sms_consent_at: new Date().toISOString(),
          sms_consent_source: "sms_keyword_start",
          sms_consent_version: null,
          sms_consent_text: body.trim().slice(0, 40),
          sms_consent_phone: from,
          sms_consent_page: null,
        } as any)
        .in("id", appIds);
    }
    return { intent };
  }

  if (intent === "help") {
    const { getBusinessPhone } = await import("@/lib/company.server");
    const { smsHelpReply } = await import("@/lib/sms-consent");
    return { intent, reply: smsHelpReply((await getBusinessPhone(supabaseAdmin)).display) };
  }

  // A real reply — stop the drip so a human can take over the conversation.
  if (appIds.length) {
    const { data: live } = await supabaseAdmin
      .from("automation_enrollments")
      .select("id,workflow_id")
      .in("application_id", appIds)
      .eq("status", "active");

    for (const enrollment of live ?? []) {
      const { data: wf } = await supabaseAdmin
        .from("automation_workflows")
        .select("stop_on_reply")
        .eq("id", enrollment.workflow_id)
        .maybeSingle();
      if (wf?.stop_on_reply) {
        await supabaseAdmin
          .from("automation_enrollments")
          .update({ status: "cancelled", cancelled_reason: "recipient replied", next_run_at: null })
          .eq("id", enrollment.id);
      }
    }

    // Surface the reply in the admin inbox.
    await supabaseAdmin.from("notifications").insert({
      kind: "sms_reply",
      title: "New SMS reply",
      body: `${from}: ${body.slice(0, 280)}`,
      channels: ["in_app"],
    });
  }

  return { intent };
}
