/**
 * Per-signer agreement resend. Staff Retry Delivery and FLEET resend-link
 * both call resendAgreementSigners. Each signer keeps their own token.
 * A still-valid token is reused when its secret is on file (link_token).
 * An expired, revoked, or unrecoverable token is reissued for that signer
 * only — never copied onto the other signers. Signers who already signed
 * are left alone.
 *
 * link_token is added by supabase/migrations/20261126120000_esign_recipient_link_resend.sql.
 * That migration is not applied here. Until it is, a resend reissues a
 * distinct token per signer so a shared token can no longer wipe signer 2.
 */
import { withinTextingHours } from "@/lib/failed-payment-link";
import type { Actor } from "@/lib/roles.server";
import type { ChannelStatus } from "@/lib/esign.server";

export const RESEND_CHANNELS = ["email", "email_and_sms"] as const;
export type ResendChannels = (typeof RESEND_CHANNELS)[number];

/** Merge fields a resent agreement must already carry. Mirrors the send gate. */
export const RESEND_REQUIRED_KEYS = [
  "driver_name", "driver_email", "driver_phone", "driver_address",
  "license_number", "license_state", "license_expiration",
  "vehicle", "vehicle_vin", "vehicle_color",
  "weekly_rate", "deposit_amount", "start_date", "return_date",
] as const;

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

export class SignerResendError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "SignerResendError";
    this.status = status;
    this.extra = extra;
  }
}

export function parseResendChannels(v: unknown): ResendChannels | "invalid" {
  if (v == null || v === "") return "email_and_sms";
  if (v === "email" || v === "email_and_sms") return v;
  return "invalid";
}

/** First character of the local part, then the domain. Empty stays empty. */
export function maskEmail(email: string | null | undefined): string | null {
  const raw = String(email ?? "").trim();
  if (!raw) return null;
  const at = raw.indexOf("@");
  if (at <= 0) return "***";
  return `${raw.slice(0, 1)}***${raw.slice(at)}`;
}

/** Best-effort. A missing link_token column must not fail the send. */
export async function rememberSigningToken(admin: any, recipientId: string | null | undefined, token: string): Promise<void> {
  if (!recipientId || !token) return;
  try {
    const { error } = await admin.from("esign_recipients").update({ link_token: token }).eq("id", recipientId);
    if (error) return;
  } catch {
    // Column not migrated yet.
  }
}

/** Records the latest open, without failing the signing page if the column is absent. */
export async function noteSignerViewed(admin: any, documentId: string, tokenHash: string, nowIso: string): Promise<void> {
  try {
    await admin.from("esign_recipients").update({ last_viewed_at: nowIso }).eq("document_id", documentId).eq("token_hash", tokenHash).eq("role", "signer").neq("status", "signed");
    await admin.from("esign_recipients").update({ viewed_at: nowIso, status: "viewed" }).eq("document_id", documentId).eq("token_hash", tokenHash).eq("role", "signer").eq("status", "sent").is("viewed_at", null);
  } catch {
    // View tracking columns are optional until the migration is applied.
  }
}

type Signer = {
  id: string;
  synthetic: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  signingOrder: number;
  status: string;
  signedAt: string | null;
  tokenHash: string | null;
  tokenExpiresAt: string | null;
  tokenRevokedAt: string | null;
  linkToken: string | null;
  smsConsent: boolean | null;
  sentAt: string | null;
  viewedAt: string | null;
};

export type ResendSignerResult = {
  id: string;
  name: string | null;
  email: string | null;
  action: "reused" | "reissued" | "skipped";
  emailStatus: ChannelStatus;
  smsStatus: ChannelStatus;
};

export type ResendSuccess = {
  ok: true;
  url: string | null;
  delivery: { email: ChannelStatus; sms: ChannelStatus; delivered: boolean };
  linkExpiresAt: string | null;
  signers: ResendSignerResult[];
};

type SendMail = (a: { to: string; firstName: string | null; url: string; vehicle: string | null }) => Promise<{ ok: boolean; error?: string }>;
type SendText = (a: { to: string; body: string; kind: string; applicationId?: string | null; requireConsent?: boolean }) => Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }>;
type Deliver = (admin: any, args: {
  id: string; url: string; email: string | null; phone: string | null; name: string | null;
  vehicle: string | null; applicationId: string | null; actor: Actor | null; allowSms?: boolean;
}) => Promise<{ email: ChannelStatus; sms: ChannelStatus; delivered: boolean }>;
type AuditFn = (e: { action: string; summary: string; entityType?: string | null; entityId?: string | null; metadata?: Record<string, unknown> }) => Promise<void>;

export type ResendArgs = {
  agreementId: string;
  signerId?: string | null;
  channels?: ResendChannels;
  actor?: Actor | null;
  source: "staff" | "fleet";
  now?: Date;
  siteUrl?: string;
  deliverSigning?: Deliver;
  sendAgreementEmail?: SendMail;
  sendSms?: SendText;
  audit?: AuditFn;
  /** Agreement statuses the conditional update may touch. */
  statuses?: string[];
  requireVoidedNull?: boolean;
  /** Staff resets a viewed agreement to sent. FLEET leaves status alone. */
  setStatusSent?: boolean;
};

function hasSigned(s: Signer): boolean {
  return s.status === "signed" || !!s.signedAt;
}

function tokenReusable(s: Signer, now: Date): boolean {
  if (hasSigned(s) || s.tokenRevokedAt || !s.tokenHash) return false;
  if (s.tokenExpiresAt && new Date(s.tokenExpiresAt).getTime() <= now.getTime()) return false;
  return true;
}

function isPrimary(s: Signer, all: Signer[], agreement: any): boolean {
  if (s.signingOrder === 1) return true;
  if (all.length === 1) return true;
  const email = (s.email ?? "").trim().toLowerCase();
  const primary = String(agreement.signer_email ?? "").trim().toLowerCase();
  return !!email && email === primary;
}

function rollup(current: ChannelStatus, next: ChannelStatus): ChannelStatus {
  if (current === "sent" || next === "sent") return "sent";
  if (current === "failed" || next === "failed") return "failed";
  return "not_attempted";
}

function mapSigner(row: any, consentByEmail: Map<string, boolean>): Signer {
  const email = row.email ? String(row.email) : null;
  const key = (email ?? "").trim().toLowerCase();
  const fromRow = typeof row.sms_consent === "boolean" ? row.sms_consent : null;
  return {
    id: String(row.id),
    synthetic: false,
    name: row.name ? String(row.name) : null,
    email,
    phone: row.phone ? String(row.phone) : null,
    role: String(row.role ?? "signer"),
    signingOrder: Number(row.signing_order ?? 0),
    status: String(row.status ?? ""),
    signedAt: row.signed_at ?? null,
    tokenHash: row.token_hash ?? null,
    tokenExpiresAt: row.token_expires_at ?? null,
    tokenRevokedAt: row.token_revoked_at ?? null,
    linkToken: typeof row.link_token === "string" ? row.link_token : null,
    smsConsent: fromRow != null ? fromRow : (key ? consentByEmail.get(key) ?? null : null),
    sentAt: row.sent_at ?? null,
    viewedAt: row.viewed_at ?? null,
  };
}

async function loadSignerRows(admin: any, agreementId: string): Promise<any[]> {
  const withSecret = await admin.from("esign_recipients")
    .select("id,name,email,phone,role,signing_order,status,token_hash,token_expires_at,token_revoked_at,signed_at,sent_at,viewed_at,link_token")
    .eq("document_id", agreementId)
    .eq("role", "signer")
    .order("signing_order", { ascending: true });
  if (!withSecret.error) return withSecret.data ?? [];
  const base = await admin.from("esign_recipients")
    .select("id,name,email,phone,role,signing_order,status,token_hash,token_expires_at,token_revoked_at,signed_at,sent_at,viewed_at")
    .eq("document_id", agreementId)
    .eq("role", "signer")
    .order("signing_order", { ascending: true });
  if (base.error) throw new SignerResendError(503, "Could not read signers.");
  const rows = base.data ?? [];
  const extra = await admin.from("esign_recipients").select("id,link_token").eq("document_id", agreementId);
  if (extra.error || !extra.data) return rows;
  const byId = new Map((extra.data as any[]).map((r) => [r.id, r]));
  return rows.map((r: any) => ({ ...r, link_token: byId.get(r.id)?.link_token ?? null }));
}

async function consentByEmail(admin: any, applicationId: string | null): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (!applicationId) return map;
  try {
    const res = await admin.from("rental_additional_drivers").select("email,sms_consent").eq("application_id", applicationId);
    if (res.error) return map;
    for (const row of res.data ?? []) {
      const email = String(row.email ?? "").trim().toLowerCase();
      if (email) map.set(email, row.sms_consent === true);
    }
  } catch {
    // Additional-driver table is not on every database yet.
  }
  return map;
}

async function writeOptional(admin: any, id: string, patch: Record<string, unknown>): Promise<void> {
  if (!id || id.startsWith("agreement:")) return;
  try {
    const { error } = await admin.from("esign_recipients").update(patch).eq("id", id);
    if (error) return;
  } catch {
    // New columns are not on the database until the migration is applied.
  }
}

export async function resendAgreementSigners(admin: any, args: ResendArgs): Promise<ResendSuccess> {
  const channels: ResendChannels = args.channels ?? "email_and_sms";
  const now = args.now ?? new Date();
  const { data: ag, error: agErr } = await admin.from("agreements")
    .select("id,application_id,status,sent_at,signer_email,signer_name,merge_data,voided_at,token_hash,token_expires_at,signed_at")
    .eq("id", args.agreementId)
    .maybeSingle();
  if (agErr) throw new SignerResendError(503, "Could not read agreements.");
  if (!ag) throw new SignerResendError(404, "Agreement not found");
  if (ag.voided_at || ag.status === "signed" || ag.status === "voided") {
    throw new SignerResendError(409, "This agreement can no longer be sent");
  }

  const merge = (ag.merge_data ?? {}) as Record<string, any>;
  const gaps = RESEND_REQUIRED_KEYS.filter((k) => !String(merge[k] ?? "").trim());
  if (gaps.length) {
    const pretty = gaps.join(", ").replace(/_/g, " ");
    if (args.source === "fleet") {
      throw new SignerResendError(409, `Prepared without ${pretty}. Staff must void and prepare a new one.`, { gaps: [...gaps] });
    }
    throw new SignerResendError(409, `This agreement was prepared without ${pretty}. Void it and prepare a new one.`);
  }

  const consent = await consentByEmail(admin, ag.application_id ?? null);
  let signers = (await loadSignerRows(admin, ag.id)).map((row) => mapSigner(row, consent));
  if (!signers.length) {
    signers = [{
      id: `agreement:${ag.id}`,
      synthetic: true,
      name: (merge.driver_name as string | null) ?? (ag.signer_name as string | null) ?? null,
      email: (ag.signer_email as string | null) ?? null,
      phone: null,
      role: "signer",
      signingOrder: 1,
      status: String(ag.status ?? ""),
      signedAt: ag.signed_at ?? null,
      tokenHash: ag.token_hash ?? null,
      tokenExpiresAt: ag.token_expires_at ?? null,
      tokenRevokedAt: null,
      linkToken: null,
      smsConsent: null,
      sentAt: ag.sent_at ?? null,
      viewedAt: null,
    }];
  }

  let targets = signers.filter((s) => !hasSigned(s));
  if (args.signerId) {
    const one = signers.find((s) => s.id === args.signerId);
    if (!one) throw new SignerResendError(404, "That signer is not on this agreement.");
    if (hasSigned(one)) throw new SignerResendError(409, "This signer has already signed.");
    targets = [one];
  }
  if (!targets.length) throw new SignerResendError(409, "Every signer has already signed.");

  const { hashToken, randomToken } = await import("@/lib/esign.server");
  const exp = new Date(now.getTime() + TOKEN_TTL_MS).toISOString();
  const plans: { signer: Signer; action: "reuse" | "reissue"; token: string; tokenHash: string }[] = [];
  for (const signer of targets) {
    if (tokenReusable(signer, now) && signer.linkToken) {
      const hashed = await hashToken(signer.linkToken);
      if (hashed === signer.tokenHash) {
        plans.push({ signer, action: "reuse", token: signer.linkToken, tokenHash: signer.tokenHash });
        continue;
      }
    }
    const token = randomToken();
    plans.push({ signer, action: "reissue", token, tokenHash: await hashToken(token) });
  }
  const issued = new Set(plans.map((p) => p.tokenHash));
  if (issued.size !== plans.length) throw new SignerResendError(503, "Could not resend the link.");

  const stamp = now.toISOString();
  const primaryPlan = plans.find((p) => isPrimary(p.signer, signers, ag));
  const patch: Record<string, unknown> = { sent_at: stamp };
  if (args.setStatusSent && !signers.some(hasSigned)) patch.status = "sent";
  if (primaryPlan?.action === "reissue") {
    patch.token_hash = primaryPlan.tokenHash;
    patch.token_expires_at = exp;
  }
  let update = admin.from("agreements").update(patch).eq("id", ag.id).in("status", args.statuses ?? ["draft", "sent", "viewed"]);
  if (args.requireVoidedNull) update = update.is("voided_at", null);
  const upd = await update.select("id");
  if (upd.error || !(upd.data ?? []).length) {
    throw new SignerResendError(
      409,
      args.source === "fleet" ? "The agreement changed while resending; nothing sent." : "This agreement can no longer be sent",
    );
  }

  for (const plan of plans) {
    if (plan.signer.synthetic) continue;
    const core: Record<string, unknown> = { sent_at: stamp, status: "sent" };
    if (plan.action === "reissue") {
      core.token_hash = plan.tokenHash;
      core.token_expires_at = exp;
      core.token_revoked_at = null;
    }
    const wrote = await admin.from("esign_recipients").update(core).eq("id", plan.signer.id).neq("status", "signed");
    if (wrote.error) throw new SignerResendError(503, "Could not update the signer.");
    await writeOptional(admin, plan.signer.id, { link_token: plan.token, link_channel: channels });
  }

  let applicationPhone: string | null = null;
  if (ag.application_id) {
    const app = await admin.from("applications").select("phone").eq("id", ag.application_id).maybeSingle();
    applicationPhone = (app.data?.phone as string | null) ?? null;
  }
  const origin = (args.siteUrl ?? (await import("@/lib/public-app-url")).publicAppOrigin()).replace(/\/$/, "");
  const deliver: Deliver = args.deliverSigning ?? (async (a, x) => (await import("@/lib/esign.server")).deliverSigningLink(a, x));
  const sendMail: SendMail = args.sendAgreementEmail ?? (async (x) => (await import("@/lib/email.server")).sendAgreementEmail(x));
  const sendSms: SendText = args.sendSms ?? (async (x) => (await import("@/lib/sms.server")).sendSms(x) as any);
  const audit: AuditFn = args.audit ?? (async (e) => (await import("@/lib/audit.server")).logAudit(args.actor ?? null, e));
  const vehicle = (merge.vehicle as string | null) || null;
  const emailOnly = channels === "email";

  const sent: { signer: Signer; action: "reuse" | "reissue"; token: string; url: string; emailStatus: ChannelStatus; smsStatus: ChannelStatus; primary: boolean }[] = [];
  for (const plan of plans) {
    const url = `${origin}/sign/${plan.token}`;
    const primary = isPrimary(plan.signer, signers, ag);
    let emailStatus: ChannelStatus = "not_attempted";
    let smsStatus: ChannelStatus = "not_attempted";
    if (primary) {
      const delivery = await deliver(admin, {
        id: ag.id,
        url,
        email: plan.signer.email ?? (ag.signer_email as string | null) ?? null,
        phone: emailOnly ? null : (applicationPhone ?? plan.signer.phone),
        name: plan.signer.name ?? (merge.driver_name as string | null) ?? null,
        vehicle,
        applicationId: ag.application_id ?? null,
        actor: args.actor ?? null,
        allowSms: !emailOnly,
      });
      emailStatus = delivery.email;
      smsStatus = emailOnly ? "not_attempted" : delivery.sms;
    } else {
      const to = (plan.signer.email ?? "").trim();
      if (to) {
        try {
          const mailed = await sendMail({ to, firstName: plan.signer.name, url, vehicle });
          emailStatus = mailed.ok ? "sent" : "failed";
        } catch {
          emailStatus = "failed";
        }
      }
      const phone = plan.signer.phone;
      if (!emailOnly && plan.signer.smsConsent === true && phone && withinTextingHours(now)) {
        try {
          const text = await sendSms({
            to: phone,
            body: `REAL RENTALS: Your rental agreement is ready to sign: ${url} Reply STOP to opt out.`,
            kind: "agreement_sent",
            applicationId: ag.application_id ?? null,
            requireConsent: false,
          });
          smsStatus = text.ok ? "sent" : text.skipped ? "not_attempted" : "failed";
        } catch {
          smsStatus = "failed";
        }
      }
    }
    await writeOptional(admin, plan.signer.id, {
      link_token: plan.token,
      link_channel: channels,
      link_email_status: emailStatus,
      link_sms_status: smsStatus,
    });
    sent.push({ signer: plan.signer, action: plan.action, token: plan.token, url, emailStatus, smsStatus, primary });
  }

  let email: ChannelStatus = "not_attempted";
  let sms: ChannelStatus = "not_attempted";
  let capped = false;
  for (const row of sent) {
    email = rollup(email, row.emailStatus);
    sms = rollup(sms, row.smsStatus);
    const who = row.signer.name || row.signer.email || "signer";
    const metadata: Record<string, unknown> = {
      signer_id: row.signer.synthetic ? null : row.signer.id,
      channel: channels,
      email: row.emailStatus,
      sms: row.smsStatus,
      token_action: row.action,
    };
    if (args.source === "fleet") {
      metadata.by = "FLEET";
      metadata.lead_id = ag.application_id ?? null;
      if (capped) metadata.cap = false;
      capped = true;
    }
    await audit({
      action: "document.resent",
      summary: args.source === "fleet" ? `Signing link resent by FLEET (automated) to ${who}` : `Signing link resent to ${who}`,
      entityType: "esign_document",
      entityId: ag.id,
      metadata,
    });
  }

  const shown = sent.find((r) => r.primary) ?? sent[0];
  return {
    ok: true,
    url: shown?.url ?? null,
    delivery: { email, sms, delivered: email === "sent" || sms === "sent" },
    linkExpiresAt: primaryPlan?.action === "reissue" ? exp : (primaryPlan?.signer.tokenExpiresAt ?? ag.token_expires_at ?? null),
    signers: sent.map((r) => ({
      id: r.signer.id,
      name: r.signer.name,
      email: r.signer.email ?? (r.primary ? (ag.signer_email as string | null) ?? null : null),
      action: r.action === "reuse" ? "reused" : "reissued",
      emailStatus: r.emailStatus,
      smsStatus: r.smsStatus,
    })),
  };
}
