import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from '@/lib/stripe.server';
import { CARD_LINK_EXPIRED_COPY } from '@/lib/card-page';
import { tierAllows } from '@/lib/roles';

type SessionResult = { clientSecret: string } | { error: string };
type CardSessionInput = {
  applicationId: string;
  returnUrl: string;
  environment: StripeEnv;
  token?: string;
};

const APPLICATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_ERROR = CARD_LINK_EXPIRED_COPY;

/**
 * Stripe keeps an idempotency key for 24 hours and rejects a retry whose
 * parameters differ. The application id stays in the key. The hash is the
 * email, name, and phone actually sent, so an identical retry is one customer
 * and a changed field is a new key.
 */
export async function cardCustomerIdempotencyKey(
  applicationId: string,
  params: { email?: string | null; name?: string | null; phone?: string | null },
): Promise<string> {
  const material = JSON.stringify({
    applicationId,
    email: params.email || null,
    name: params.name || null,
    phone: params.phone || null,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `card-on-file-customer:${applicationId}:${hash}`;
}

const SETUP_ERROR = "Could not start the card setup. Ask us for a new link and we'll send it over.";

/**
 * Stripe's own message, for a Stripe error only.
 * A key fragment, an env-var name, or a database error stays the generic sentence.
 */
function cardSetupError(error: unknown): string {
  const message = getStripeErrorMessage(error);
  const type = error && typeof error === "object" && "type" in error ? String((error as { type?: unknown }).type ?? "") : "";
  if (!type.startsWith("Stripe")) return SETUP_ERROR;
  if (/sk_(live|test)_|rk_(live|test)_|whsec_|api[_ -]?key|LOVABLE_API_KEY|STRIPE_[A-Z0-9_]+|Bearer /i.test(message)) {
    return SETUP_ERROR;
  }
  return message;
}

const attempts = new Map<string, number[]>();

/**
 * Per-process counter only. Each server isolate has its own map, a deploy or
 * restart clears it, and two instances do not share counts. This slows one
 * process after someone is already authenticated. It is not a global lock.
 * A rejected return URL is checked before this and does not consume an attempt.
 */
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const kept = (attempts.get(key) ?? []).filter((at) => now - at < windowMs);
  if (kept.length >= max) {
    attempts.set(key, kept);
    return true;
  }
  kept.push(now);
  attempts.set(key, kept);
  return false;
}

function httpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function allowedReturnOrigin(origin: string): boolean {
  const allowed = new Set<string>(['https://drivereal.com', 'https://www.drivereal.com']);
  const site = httpsOrigin(process.env.SITE_URL);
  if (site) {
    allowed.add(site);
    const host = new URL(site).hostname;
    allowed.add(host.startsWith('www.') ? `https://${host.slice(4)}` : `https://www.${host}`);
  }
  if (allowed.has(origin)) return true;
  // Local return URLs are for the dev server only. Production must not accept them.
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** The Stripe return URL is only this application's card page on our own origin. */
function cardReturnUrl(applicationId: string, requested: string): string | null {
  let url: URL;
  try {
    url = new URL(requested);
  } catch {
    return null;
  }
  if (url.pathname !== `/card/${applicationId}`) return null;
  if (url.searchParams.get('status') !== 'success') return null;
  if ([...url.searchParams.keys()].some((key) => key !== 'status')) return null;
  if (!allowedReturnOrigin(url.origin)) return null;
  return `${url.origin}/card/${applicationId}?status=success`;
}

/** The signed-in user, if the browser attached a bearer token. No token is anonymous. */
async function callerUserId(): Promise<string | null> {
  try {
    const { getRequest } = await import('@tanstack/react-start/server');
    const header = getRequest()?.headers?.get('authorization') ?? '';
    if (!header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return null;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getClaims(token);
    const sub = data?.claims?.sub;
    if (error || !sub) return null;
    return String(sub);
  } catch {
    return null;
  }
}

export const createCardOnFileSession = createServerFn({ method: 'POST' })
  .inputValidator((data: CardSessionInput) => {
    if (!data || typeof data.applicationId !== 'string' || !APPLICATION_ID.test(data.applicationId)) {
      throw new Error('Invalid application');
    }
    if (data.token != null && (typeof data.token !== 'string' || data.token.length < 20 || data.token.length > 200)) {
      throw new Error('Invalid application');
    }
    if (typeof data.returnUrl !== 'string' || data.returnUrl.length < 8 || data.returnUrl.length > 500) {
      throw new Error('Invalid application');
    }
    if (data.environment !== 'sandbox' && data.environment !== 'live') throw new Error('Invalid application');
    return data;
  })
  .handler(async ({ data }): Promise<SessionResult> => {
    // Auth before any Stripe call. Holding the application id is not enough.
    const userId = await callerUserId();
    let allowed = false;
    if (userId) {
      const { getActor } = await import('@/lib/roles.server');
      const actor = await getActor(userId);
      if (actor && tierAllows(actor.tier, 'manager')) allowed = true;
    }
    if (!allowed && data.token) {
      try {
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { resolveCardToken } = await import('@/lib/resume-tokens.server');
        const unlocked = await resolveCardToken(supabaseAdmin, data.token);
        if (unlocked === data.applicationId) allowed = true;
      } catch {
        allowed = false;
      }
    }
    if (!allowed && userId) {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: owned } = await supabaseAdmin
        .from('applications')
        .select('user_id')
        .eq('id', data.applicationId)
        .maybeSingle();
      if (owned?.user_id && owned.user_id === userId) allowed = true;
    }
    if (!allowed) return { error: LINK_ERROR };

    const returnUrl = cardReturnUrl(data.applicationId, data.returnUrl);
    if (!returnUrl) return { error: LINK_ERROR };
    if (rateLimited(`card-setup:${data.applicationId}`, 8, 10 * 60_000)) return { error: SETUP_ERROR };

    try {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: app, error } = await supabaseAdmin
        .from('applications')
        .select('id, user_id, full_name, email, phone, stripe_customer_id')
        .eq('id', data.applicationId)
        .maybeSingle();
      if (error || !app) return { error: LINK_ERROR };

      let customerId = (app.stripe_customer_id as string | null) ?? null;
      if (!customerId) {
        const { data: fresh } = await supabaseAdmin
          .from('applications')
          .select('stripe_customer_id')
          .eq('id', app.id)
          .maybeSingle();
        customerId = (fresh?.stripe_customer_id as string | null) ?? null;
      }

      const stripe = createStripeClient(data.environment);
      if (!customerId) {
        const email = typeof app.email === 'string' ? app.email : null;
        const name = typeof app.full_name === 'string' ? app.full_name : null;
        const phone = typeof app.phone === 'string' ? app.phone : null;
        const created = await stripe.customers.create(
          {
            ...(email ? { email } : {}),
            ...(name ? { name } : {}),
            ...(phone ? { phone } : {}),
            metadata: { applicationId: app.id as string },
          },
          { idempotencyKey: await cardCustomerIdempotencyKey(app.id as string, { email, name, phone }) },
        );
        customerId = created.id;
        const { data: saved, error: saveError } = await supabaseAdmin
          .from('applications')
          .update({ stripe_customer_id: customerId })
          .eq('id', app.id)
          .is('stripe_customer_id', null)
          .select('stripe_customer_id')
          .maybeSingle();
        if (saveError) {
          console.error('card-on-file: applications.stripe_customer_id update failed', saveError.message ?? saveError);
        }
        if (!saved?.stripe_customer_id) {
          const { data: winner } = await supabaseAdmin
            .from('applications')
            .select('stripe_customer_id')
            .eq('id', app.id)
            .maybeSingle();
          if (winner?.stripe_customer_id) customerId = winner.stripe_customer_id as string;
        }
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'setup',
        ui_mode: 'embedded_page',
        currency: 'usd',
        customer: customerId,
        return_url: returnUrl,
        payment_method_types: ['card'],
        metadata: { applicationId: app.id as string, purpose: 'card_on_file' },
      });
      if (!session.client_secret) return { error: SETUP_ERROR };
      return { clientSecret: session.client_secret };
    } catch (error) {
      return { error: cardSetupError(error) };
    }
  });

/** Manager-only. Mint the resume token the card page requires and return its path. */
export const issueCardOnFileLink = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { applicationId: string }) => {
    if (!data || typeof data.applicationId !== 'string' || !APPLICATION_ID.test(data.applicationId)) {
      throw new Error('Invalid application');
    }
    return data;
  })
  .handler(async ({ data, context }): Promise<{ path: string; expiresAt: number }> => {
    const { requireManager } = await import('@/lib/roles.server');
    await requireManager(context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { issueResumeToken, rememberedCardExpiry } = await import('@/lib/resume-tokens.server');
    const token = await issueResumeToken(supabaseAdmin, data.applicationId, { purpose: 'card' });
    const expiresAt = rememberedCardExpiry(data.applicationId);
    if (expiresAt == null) throw new Error('Could not prepare the card link.');
    return { path: `/card/${data.applicationId}?t=${encodeURIComponent(token)}`, expiresAt };
  });

export const removeCardOnFile = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { applicationId: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    try {
      const { data: isAdmin } = await (context.supabase as any).rpc('has_role', {
        _user_id: context.userId,
        _role: 'admin',
      });
      if (!isAdmin) throw new Error('Forbidden');

      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data: app } = await supabaseAdmin
        .from('applications')
        .select('stripe_payment_method_id')
        .eq('id', data.applicationId)
        .maybeSingle();

      if (app?.stripe_payment_method_id) {
        const stripe = createStripeClient(data.environment);
        try {
          await stripe.paymentMethods.detach(app.stripe_payment_method_id as string);
        } catch {
          // ignore detach failure — clear locally regardless
        }
      }
      await supabaseAdmin
        .from('applications')
        .update({
          stripe_payment_method_id: null,
          card_brand: null,
          card_last4: null,
          card_exp_month: null,
          card_exp_year: null,
          card_on_file_at: null,
        })
        .eq('id', data.applicationId);

      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });