// Safe Autofill — I/O. Runs after a Fleet Inbox item's proposals are built
// (no extra AI call). Off by default; Owner-controlled; daily cap; fail-closed
// pause. Writes only blank fields via a conditional update, records a full
// history row + provenance + audit entry, and can be undone by an Owner.
import { evaluateAutofill, readAutofillSettings, AUTO_FIELDS, type AutofillSettings } from "@/lib/safe-autofill";
import { authorityOf } from "@/lib/fleet-inbox";

const KEY = "safe_autofill";
const OPEN = ["pending", "applied", "failed", "ignored"]; // superseded evidence is not counted

export async function loadAutofillSettings(sb: any): Promise<AutofillSettings> {
  const { data } = await sb.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  return readAutofillSettings(data?.value);
}
export async function saveAutofillSettings(sb: any, s: AutofillSettings) {
  const { error } = await sb.from("app_settings").upsert({ key: KEY, value: s });
  if (error) throw new Error("Could not save autofill settings.");
}
async function pause(sb: any, reason: string) {
  const s = await loadAutofillSettings(sb);
  await saveAutofillSettings(sb, { ...s, paused_reason: reason, paused_at: new Date().toISOString() });
}
export async function autofillUsedToday(sb: any): Promise<number> {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const { count } = await sb.from("vehicle_autofill_events").select("id", { count: "exact", head: true }).gte("created_at", start.toISOString());
  return count ?? 0;
}

export type AutofillRun = { status: "off" | "paused" | "cap_reached" | "done" | "error"; filled: number; skipped: number; message?: string };

/** Never throws: a failure pauses autofill and leaves the review path untouched. */
export async function runSafeAutofillForItem(sb: any, itemId: string): Promise<AutofillRun> {
  try {
    const settings = await loadAutofillSettings(sb);
    if (!settings.enabled) return { status: "off", filled: 0, skipped: 0 };
    if (settings.paused_reason) return { status: "paused", filled: 0, skipped: 0, message: settings.paused_reason };
    let budget = settings.daily_cap - (await autofillUsedToday(sb));
    if (budget <= 0) return { status: "cap_reached", filled: 0, skipped: 0 };

    const { data: item } = await sb.from("fleet_import_items").select("id,batch_id,document_id,doc_class,analyzed_at").eq("id", itemId).maybeSingle();
    if (!item?.document_id) return { status: "done", filled: 0, skipped: 0 };
    const { data: props } = await sb.from("fleet_import_proposals").select("id,vin,page,fields,status").eq("item_id", itemId).eq("status", "pending");
    let filled = 0, skipped = 0;
    for (const p of props ?? []) {
      if (budget <= 0) break;
      const vin = String(p.vin ?? "").toUpperCase();
      if (vin.length !== 17) continue;
      const { data: vehicle } = await sb.from("vehicles").select(`id,vin,model,${AUTO_FIELDS.join(",")}`).eq("vin", vin).is("archived_at", null).maybeSingle();
      if (!vehicle) continue;
      const { data: others } = await sb.from("fleet_import_proposals").select("fields").eq("vin", vin).neq("id", p.id).in("status", OPEN).limit(200);
      const otherEvidence: Record<string, string[]> = {};
      for (const o of others ?? []) for (const f of AUTO_FIELDS) { const v = (o.fields as any)?.[f]?.value; if (v != null && String(v).trim()) (otherEvidence[f] ??= []).push(String(v)); }
      const { fill, skipped: sk } = evaluateAutofill({ vehicle, docClass: item.doc_class, proposalVin: vin, fields: (p.fields ?? {}) as any, otherEvidence });
      skipped += sk.length;
      for (const c of fill) {
        if (budget <= 0) break;
        // Conditional write: only if still blank at this instant (no overwrite race).
        let q = sb.from("vehicles").update({ [c.field]: c.value }).eq("id", vehicle.id);
        // Compare the exact blank state we read; a concurrent change safely skips.
        // AUTO_FIELDS is fixed, and neither column nor value enters raw syntax.
        q = vehicle[c.field] == null ? q.is(c.field, null) : q.eq(c.field, "");
        const { data: upd, error } = await q.select("id");
        if (error) throw new Error(`Could not write ${c.field}.`);
        if (!upd?.length) { skipped++; continue; }
        const { error: evErr } = await sb.from("vehicle_autofill_events").insert({
          vehicle_id: vehicle.id, field: c.field, previous_value: null, new_value: String(c.value),
          document_id: item.document_id, page: p.page ?? null, proposal_id: p.id, batch_id: item.batch_id, doc_class: item.doc_class,
          evidence_raw: c.raw, confidence: c.confidence,
        });
        if (evErr) { // history must exist for every write — revert and stop
          await sb.from("vehicles").update({ [c.field]: null }).eq("id", vehicle.id).eq(c.field, c.value);
          throw new Error("Could not record autofill history.");
        }
        await sb.from("vehicle_field_provenance").upsert({
          vehicle_id: vehicle.id, field: c.field, value: String(c.value), raw_value: c.raw, document_id: item.document_id, doc_class: item.doc_class,
          authority: authorityOf(c.field, item.doc_class), page: p.page ?? null, method: "auto_fill", confidence: c.confidence,
          extracted_at: item.analyzed_at, confirmed_by: null, proposal_id: p.id,
        }, { onConflict: "proposal_id,field", ignoreDuplicates: true });
        const { logAudit } = await import("@/lib/audit.server");
        await logAudit(null, { action: "vehicle.autofilled", summary: `Safe Autofill set ${c.field} to ${c.value}`, entityType: "vehicle", entityId: vehicle.id,
          metadata: { field: c.field, from: null, to: c.value, document_id: item.document_id, page: p.page ?? null, proposal_id: p.id, confidence: c.confidence, actor: "safe-autofill" } });
        filled++; budget--;
      }
    }
    return { status: budget <= 0 ? "cap_reached" : "done", filled, skipped };
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 200);
    try { await pause(sb, `Paused after an error: ${msg}`); } catch { /* best effort */ }
    return { status: "error", filled: 0, skipped: 0, message: msg };
  }
}

/** Undo automatic fills for one vehicle or one import batch. Skips anything edited since. */
export async function undoAutofill(sb: any, actor: { userId: string } & Record<string, any>, scope: { vehicleId?: string; batchId?: string }) {
  let q = sb.from("vehicle_autofill_events").select("*").is("undone_at", null);
  q = scope.vehicleId ? q.eq("vehicle_id", scope.vehicleId) : q.eq("batch_id", scope.batchId);
  const { data: events } = await q.order("created_at", { ascending: false }).limit(1000);
  let reverted = 0, kept = 0;
  for (const ev of events ?? []) {
    const { data: v } = await sb.from("vehicles").select(`id,${ev.field}`).eq("id", ev.vehicle_id).maybeSingle();
    const current = v ? (v as any)[ev.field] : undefined;
    const { data: later } = await sb.from("audit_log").select("id,metadata").eq("entity_id", ev.vehicle_id).neq("action", "vehicle.autofilled").gt("created_at", ev.created_at).limit(200);
    const editedLater = (later ?? []).some((a: any) => a.metadata && (ev.field in a.metadata || (Array.isArray(a.metadata.fields) && a.metadata.fields.includes(ev.field))));
    let result = "kept_edited";
    if (v && current != null && String(current) === ev.new_value && !editedLater) {
      const { data: upd } = await sb.from("vehicles").update({ [ev.field]: ev.previous_value }).eq("id", ev.vehicle_id).eq(ev.field, ev.field === "seats" ? Number(ev.new_value) : ev.new_value).select("id");
      if (upd?.length) {
        result = "reverted"; reverted++;
        await sb.from("vehicle_field_provenance").delete().eq("proposal_id", ev.proposal_id).eq("field", ev.field).eq("method", "auto_fill");
      } else kept++;
    } else kept++;
    await sb.from("vehicle_autofill_events").update({ undone_at: new Date().toISOString(), undone_by: actor.userId, undo_result: result }).eq("id", ev.id);
  }
  const { logAudit } = await import("@/lib/audit.server");
  await logAudit(actor as any, { action: "vehicle.autofill_undone", summary: `Undid ${reverted} automatic fill(s); kept ${kept} edited since`, entityType: scope.vehicleId ? "vehicle" : "fleet_import_batch", entityId: scope.vehicleId ?? scope.batchId ?? null, metadata: { reverted, kept } });
  return { reverted, kept };
}
