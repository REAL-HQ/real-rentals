import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from '@/lib/stripe.server';
import { tierAllows } from '@/lib/roles';

type SessionResult = { clientSecret: string } | { error: string };
type CardSessionInput = {
  applicationId: string;
  returnUrl: string;
  environment: StripeEnv;
  token?: string;
};

const APPLICATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_ERROR = "This link is no longer valid. Ask us for a new one and we'll send it over.";
const SETUP_ERROR = "Could not start the card setup. Ask us for a new link and we'll send it over.";

const attempts = new Map<string, number[]>();

/** True when this key has already been used `max` times inside the window. */
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

function allowedReturnOrigin(origin: string): boolean {
  if (origin === 'https://drivereal.com') return true;
  const site = process.env.SITE_URL?.replace(/\/$/, '');
  if (site && origin === site) return true;
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
        const { resolveResumeToken } = await import('@/lib/resume-tokens.server');
        const unlocked = await resolveResumeToken(supabaseAdmin, data.token);
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
        const created = await stripe.customers.create(
          {
            ...(app.email && { email: app.email as string }),
            ...(app.full_name && { name: app.full_name as string }),
            ...(app.phone && { phone: app.phone as string }),
            metadata: { applicationId: app.id as string },
          },
          { idempotencyKey: `card-on-file-customer:${app.id}` },
        );
        customerId = created.id;
        const { data: saved } = await supabaseAdmin
          .from('applications')
          .update({ stripe_customer_id: customerId })
          .eq('id', app.id)
          .is('stripe_customer_id', null)
          .select('stripe_customer_id')
          .maybeSingle();
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
    } catch {
      return { error: SETUP_ERROR };
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
  .handler(async ({ data, context }): Promise<{ path: string }> => {
    const { requireManager } = await import('@/lib/roles.server');
    await requireManager(context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { issueResumeToken } = await import('@/lib/resume-tokens.server');
    const token = await issueResumeToken(supabaseAdmin, data.applicationId);
    return { path: `/card/${data.applicationId}?t=${encodeURIComponent(token)}` };
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