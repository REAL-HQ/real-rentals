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
  /**
   * True when the application is already owned by a different account than the
   * email on file resolves to. Nothing is created, nothing is relinked, and
   * nothing is emailed — a human has to decide which identity is right.
   */
  conflict: boolean;
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
  const target = args.email.trim().toLowerCase();

  /*
   * An application that already belongs to somebody is never handed to
   * somebody else.
   *
   * This function resolves an identity from the email on the application, and
   * that email is editable — by staff, and by the driver themselves in
   * Settings. Without this check, changing it and re-approving would relink
   * the application to whatever account the new address resolves to: the
   * original driver silently loses their documents, agreement and payment
   * history, and the new address gains them. If the new address had no
   * account, one would be created and sent a "you're approved, set your
   * password" email for an application that person never filed.
   *
   * So a mismatch stops here, before anything is created, granted, linked or
   * mailed. It is reported to the operator instead, because deciding which
   * identity is the real one is a human judgement, not a default.
   */
  const { data: existing } = await admin
    .from("applications")
    .select("user_id")
    .eq("id", args.applicationId)
    .maybeSingle();

  const ownerId = (existing?.user_id as string | null) ?? null;
  if (ownerId) {
    const { data: owner } = await admin.auth.admin.getUserById(ownerId);
    const ownerEmail = String(owner?.user?.email ?? "")
      .trim()
      .toLowerCase();
    if (ownerEmail && ownerEmail !== target) {
      console.error(
        "[driver-account] refusing to relink application",
        args.applicationId,
        "— owned by an account whose email differs from the one on file",
      );
      return { userId: ownerId, conflict: true, created: false, inviteUrl: null };
    }
    // Same person. Fall through: the role grant below is still worth
    // re-running, and nothing is created because the user already exists.
  }

  const { userId, created } = await ensureAuthUser(admin, target, args.fullName);

  /*
   * A pre-existing account is only adopted when it is plausibly the same
   * person.
   *
   * ensureAuthUser matches on the email string alone, and anyone can create an
   * account for any address through the public sign-up forms. Without this,
   * registering with a pending applicant's email before we approve them meant
   * the approval granted THAT account the driver role and pointed the
   * application at it — handing over the applicant's licence, insurance,
   * agreement (which signMyAgreement would then let them execute in the
   * applicant's name), payments and, later, the vehicle.
   *
   * An account this call just created is safe by construction. An account that
   * already owns an application under the same address is the returning-driver
   * case and is also safe. Anything else is a stranger holding the address, so
   * nothing is granted, linked or emailed and a human is told.
   */
  if (!created && !ownerId) {
    const { data: owned } = await admin
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    if (!owned || owned.length === 0) {
      console.error(
        "[driver-account] refusing to adopt pre-existing account for application",
        args.applicationId,
        "— the account holds the address but no application of its own",
      );
      return { userId, conflict: true, created: false, inviteUrl: null };
    }
  }

  // Ignore a duplicate — the role may already be granted, and this function
  // is expected to run more than once for the same person.
  const { error: roleErr } = await admin
    .from("user_roles")
    .insert({ user_id: userId, role: "driver" });
  // A duplicate is the expected outcome on a repeat call. Anything else means
  // the account exists but cannot open the portal, so it is a failure of this
  // function rather than a line in a log: reporting success here sends somebody
  // a set-password email for an account that lands on "No Driver Access".
  if (roleErr && !String(roleErr.message).includes("duplicate key")) {
    console.error("[driver-account] role grant failed", roleErr.message);
    throw new Error(`Driver role could not be granted: ${roleErr.message}`);
  }

  // Link the application to the account. Without this the portal has nothing
  // to show: every driver-facing query resolves through applications.user_id.
  const { error: linkErr } = await admin
    .from("applications")
    .update({ user_id: userId })
    .eq("id", args.applicationId);
  // Same reasoning: without the link the portal has no application to read, so
  // the driver signs in to an empty shell. Fail loudly instead.
  if (linkErr) {
    console.error("[driver-account] application link failed", linkErr.message);
    throw new Error(`Application could not be linked to the login: ${linkErr.message}`);
  }

  let inviteUrl: string | null = null;
  if (created) {
    try {
      const { data: link } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: target,
      });
      inviteUrl = (link?.properties?.action_link as string) ?? null;
    } catch (e) {
      // The welcome email falls back to the portal URL, and the driver can
      // still use Forgot Password from there.
      console.error("[driver-account] invite link failed", e);
    }
  }

  return { userId, conflict: false, created, inviteUrl };
}
