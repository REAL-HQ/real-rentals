/**
 * One way to give an applicant a login.
 *
 * This used to live inside activateRental, which meant the account came into
 * existence at the moment a car was assigned. That is the wrong moment. The
 * window between "we approved you" and "here are your keys" is exactly when
 * an applicant needs to be uploading documents and signing a contract, and it
 * was the one window in which they had nowhere to sign in — everything went
 * through emailed resume links instead.
 *
 * So provisioning moved to approval, and both callers share this. It is
 * idempotent on purpose: approval provisions, activation calls it again and
 * finds everything already done. Re-approving, or approving someone who once
 * rented before, is a no-op rather than an error.
 *
 * Nothing here is gated on a rental, and nothing downstream is either — the
 * driver-facing reads and writes (getMyVault, updateDriverProfile, the
 * "Drivers view their own documents" policy) all scope by
 * applications.user_id, never by an active rental. That is what makes a
 * pre-rental portal possible without touching the schema.
 *
 * Server-only: it uses the service role to reach auth.admin.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * The service-role client. Typed, not `any`: everything this module touches —
 * user_roles, applications, auth.admin — is worth having the compiler check.
 */
type AdminClient = SupabaseClient<Database>;

export type DriverAccount = {
  userId: string;
  /** True only on the call that actually created the auth user. */
  created: boolean;
  /**
   * A set-password link, present only when `created` is true and the link
   * could be generated. Callers put it in the welcome email; a returning
   * driver gets the plain portal URL instead, because they already have a
   * password.
   */
  inviteUrl: string | null;
};

/**
 * Find or create the auth user for an email address.
 *
 * listUsers is paginated and has no server-side email filter, so page until
 * we find them. Small user base; bounded to avoid an unbounded loop.
 */
async function ensureAuthUser(
  admin: AdminClient,
  email: string,
  fullName: string | null,
): Promise<{ userId: string; created: boolean }> {
  const target = email.trim().toLowerCase();

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const hit = users.find((u) => String(u.email ?? "").toLowerCase() === target);
    if (hit) return { userId: hit.id as string, created: false };
    if (users.length < 200) break;
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: target,
    email_confirm: true,
    user_metadata: { full_name: fullName ?? null },
  });
  if (createErr || !created?.user)
    throw new Error(createErr?.message || "Could not create driver login");
  return { userId: created.user.id as string, created: true };
}

/**
 * Give this applicant an account they can sign into, and link it to their
 * application so the portal can find their documents, profile and agreement.
 *
 * Throws only if the auth user cannot be created — the caller decides whether
 * that is fatal. Granting the role and linking the application are reported
 * through the console rather than thrown, because losing the login is a
 * different severity from losing a role grant that the next call repairs.
 */
export async function provisionDriverAccount(
  admin: AdminClient,
  args: { applicationId: string; email: string; fullName: string | null },
): Promise<DriverAccount> {
  const { userId, created } = await ensureAuthUser(admin, args.email, args.fullName);

  // Ignore a duplicate — the role may already be granted, and this function
  // is expected to run more than once for the same person.
  const { error: roleErr } = await admin
    .from("user_roles")
    .insert({ user_id: userId, role: "driver" });
  if (roleErr && !String(roleErr.message).includes("duplicate key")) {
    console.error("[driver-account] role grant failed", roleErr.message);
  }

  // Link the application to the account. Without this the portal has nothing
  // to show: every driver-facing query resolves through applications.user_id.
  const { error: linkErr } = await admin
    .from("applications")
    .update({ user_id: userId })
    .eq("id", args.applicationId);
  if (linkErr) console.error("[driver-account] application link failed", linkErr.message);

  let inviteUrl: string | null = null;
  if (created) {
    try {
      const { data: link } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: args.email,
      });
      inviteUrl = (link?.properties?.action_link as string) ?? null;
    } catch (e) {
      // The welcome email falls back to the portal URL, and the driver can
      // still use Forgot Password from there.
      console.error("[driver-account] invite link failed", e);
    }
  }

  return { userId, created, inviteUrl };
}
