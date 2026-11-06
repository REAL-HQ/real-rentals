/* eslint-disable @typescript-eslint/no-explicit-any -- the service-role client is used untyped here, as in rentals.functions.ts */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { policyNumberLast4 } from "@/lib/insurance-verification";

// Insurance verification decisions: Managers and Owners only, every decision audited, and an
// audit failure refuses the decision. Coordinators may request verification (audited too).

type Rpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export const DECISION_NOT_INSTALLED_NOTE =
  "Recorded through the server fallback: the database decision function is not installed, so the audit row was written first and the decision applied after it (not one transaction).";

export const setInsuranceVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        verified: z.boolean(),
        note: z.string().trim().max(500).nullable().optional(),
      })
      .strict()
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ verified: boolean; decidedAt: string; atomic: boolean }> => {
      const { requireManager } = await import("@/lib/roles.server");
      const actor = await requireManager(context.userId);
      // Preferred: the database function, with the caller's own session, so the decision and its
      // audit row commit together and private.is_manager() is checked again.
      const { data: res, error } = await (context.supabase as unknown as Rpc).rpc(
        "set_insurance_verification",
        {
          _application_id: data.applicationId,
          _verified: data.verified,
          _note: data.note ?? null,
        },
      );
      if (!error) {
        const r = (res ?? {}) as { verified?: boolean; decided_at?: string };
        if (r.verified !== data.verified)
          throw new Error("Could not confirm the insurance decision.");
        return { verified: data.verified, decidedAt: String(r.decided_at ?? ""), atomic: true };
      }
      if (error.code !== "PGRST202") {
        if (error.code === "42501" || /manager_required/.test(String(error.message)))
          throw new Error("Only a Manager or Owner can verify or revoke insurance.");
        throw new Error("Could not save the insurance decision. Nothing was changed.");
      }
      // Fallback until the database package is installed: audit first (refuse if it fails), then apply.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as any;
      const [{ data: scr }, { data: app }, { data: doc }] = await Promise.all([
        admin
          .from("driver_screenings")
          .select(
            "id,insurance_verified,insurance_verified_at,insurance_verified_by,insurance_carrier,insurance_policy_number",
          )
          .eq("lead_id", data.applicationId)
          .maybeSingle(),
        admin
          .from("applications")
          .select("id,insurance_carrier,insurance_policy_number,insurance_expires_on")
          .eq("id", data.applicationId)
          .maybeSingle(),
        admin
          .from("documents")
          .select("id,content_sha256,storage_path,expires_at,review_status")
          .eq("driver_id", data.applicationId)
          .eq("is_current", true)
          .eq("category", "insurance")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (!app) throw new Error("Application not found");
      const decidedAt = new Date().toISOString();
      const policy = String(scr?.insurance_policy_number || app.insurance_policy_number || "")
        .replace(/\s/g, "")
        .toUpperCase();
      const { sha256Hex } = await import("@/lib/paper-agreements");
      const { error: auditErr } = await admin.from("audit_log").insert({
        actor_user_id: actor.userId,
        actor_email: actor.email ?? null,
        actor_role: actor.role,
        action: data.verified ? "insurance.verified" : "insurance.verification_revoked",
        entity_type: "application",
        entity_id: data.applicationId,
        summary: data.verified ? "Insurance verified" : "Insurance verification revoked",
        metadata: {
          decision: data.verified ? "verified" : "revoked",
          from: scr?.insurance_verified === true,
          to: data.verified,
          decided_at: decidedAt,
          decided_by: actor.userId,
          note: data.note ?? null,
          screening_id: scr?.id ?? null,
          previous_verified_at: scr?.insurance_verified_at ?? null,
          previous_verified_by: scr?.insurance_verified_by ?? null,
          document: doc
            ? {
                id: doc.id,
                content_sha256: doc.content_sha256 ?? null,
                storage_path: doc.storage_path,
                expires_at: doc.expires_at ?? null,
                review_status: doc.review_status ?? null,
              }
            : null,
          insurer: scr?.insurance_carrier || app.insurance_carrier || null,
          policy_number_last4: policyNumberLast4(policy),
          policy_number_sha256: policy ? await sha256Hex(new TextEncoder().encode(policy)) : null,
          policy_expires_on: app.insurance_expires_on ?? null,
          source: "server_fallback",
          atomic: false,
          fallback_note: DECISION_NOT_INSTALLED_NOTE,
        },
      });
      if (auditErr)
        throw new Error("Could not record the insurance decision. Nothing was changed.");
      const patch = {
        insurance_verified: data.verified,
        insurance_verified_at: data.verified ? decidedAt : null,
        insurance_verified_by: data.verified ? (actor.email ?? actor.userId) : null,
      };
      const { error: upErr } = scr
        ? await admin.from("driver_screenings").update(patch).eq("id", scr.id)
        : await admin.from("driver_screenings").insert({ lead_id: data.applicationId, ...patch });
      if (upErr) throw new Error("The decision was audited but could not be saved. Try again.");
      return { verified: data.verified, decidedAt, atomic: false };
    },
  );

export const requestInsuranceVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        note: z.string().trim().max(500).nullable().optional(),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("audit_log").insert({
      actor_user_id: actor.userId,
      actor_email: actor.email ?? null,
      actor_role: actor.role,
      action: "insurance.verification_requested",
      entity_type: "application",
      entity_id: data.applicationId,
      summary: "Insurance verification requested",
      metadata: {
        requested_by: actor.userId,
        requested_tier: actor.tier,
        note: data.note ?? null,
        requested_at: new Date().toISOString(),
      },
    });
    if (error) throw new Error("Could not record the request. Try again.");
    return { ok: true };
  });

export type InsuranceVerificationActivity = {
  lastDecision: { action: string; at: string; by: string | null } | null;
  lastRequest: { at: string; by: string | null; note: string | null } | null;
};

/** The latest decision and request, for the insurance card. Any staff tier. */
export const getInsuranceVerificationActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }): Promise<InsuranceVerificationActivity> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("audit_log")
      .select("action,actor_email,created_at,metadata")
      .eq("entity_type", "application")
      .eq("entity_id", data.applicationId)
      .in("action", [
        "insurance.verified",
        "insurance.verification_revoked",
        "insurance.verification_requested",
      ])
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error("Could not load insurance verification activity");
    const list = (rows ?? []) as {
      action: string;
      actor_email: string | null;
      created_at: string;
      metadata: any;
    }[];
    const d = list.find((r) => r.action !== "insurance.verification_requested");
    const q = list.find((r) => r.action === "insurance.verification_requested");
    return {
      lastDecision: d ? { action: d.action, at: d.created_at, by: d.actor_email } : null,
      lastRequest:
        q && (!d || q.created_at > d.created_at)
          ? { at: q.created_at, by: q.actor_email, note: q.metadata?.note ?? null }
          : null,
    };
  });
