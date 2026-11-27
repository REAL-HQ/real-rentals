import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Partner Portal v2 (Nov 17 2026): the old getMyPartner / getRenterDocumentUrl /
// getMyEarnings reads returned the renter's name, background/MVR/earnings
// vetting results, licence and rental agreement to partners. They are gone.
// The portal now reads only through partner-portal.functions.ts, whose
// whitelists (partner-portal.ts) never select renter, agreement or insurance
// data.

// Admin-only: link a partner row to a Supabase auth user by email, and grant
// them the 'partner' role.
export const linkPartnerLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ partnerId: z.string().uuid(), email: z.string().email() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: adminRow } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRow) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Look up user by email
    let userId: string | null = null;
    let page = 1;
    while (page < 20) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      const target = data.email.toLowerCase();
      const match = list.users.find((u) => ((u.email ?? "") as string).toLowerCase() === target);
      if (match) { userId = match.id; break; }
      if (list.users.length < 200) break;
      page += 1;
    }
    if (!userId) throw new Error(`No user account found for ${data.email}. Ask them to sign up at /partner first.`);

    // Set partners.user_id
    const { error: pErr } = await supabaseAdmin
      .from("partners")
      .update({ user_id: userId })
      .eq("id", data.partnerId);
    if (pErr) throw new Error(pErr.message);

    // Insert partner role (idempotent on (user_id, role))
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "partner" as any }, { onConflict: "user_id,role" });
    if (rErr && !/duplicate/i.test(rErr.message)) throw new Error(rErr.message);

    return { ok: true, userId };
  });