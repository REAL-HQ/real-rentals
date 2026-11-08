// Dispatch-time switches for Back Office → Automations. Server only.
//
// sendEmail asks automationAllowsEmail(workflow) before it does anything
// else, so every send path — cron, Stripe webhook, server function — honours
// the switch without each caller remembering to. The cron routes also call
// loadAutomationControls up front so a switched-off reminder is skipped
// before its dedupe row or bell notification is written.
//
// Read errors fail OPEN (send as before): this setting only ever turns things
// off, and a database blip must not silently stop receipts or alerts that ran
// before this existed. The switch's state is shown in the back office.

import {
  AUTOMATION_CONTROLS_KEY,
  isAutomationOn,
  readAutomationControls,
  settingKeyForEmailWorkflow,
  type AutomationControlsValue,
} from "@/lib/automation-catalog";

const CACHE_MS = 30_000;
let cache: { at: number; value: AutomationControlsValue } | null = null;

type Reader = {
  from: (t: string) => {
    select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: { value: unknown } | null; error: unknown }> } };
  };
};

/** The stored switches. `fresh` skips the 30s cache (the settings screen and cron runs use it). */
export async function loadAutomationControls(admin?: unknown, fresh = false): Promise<AutomationControlsValue> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const sb = (admin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin) as unknown as Reader;
    const { data, error } = await sb.from("app_settings").select("value").eq("key", AUTOMATION_CONTROLS_KEY).maybeSingle();
    if (error) return { off: {} };
    const value = readAutomationControls(data?.value);
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return { off: {} };
  }
}

/** Forget the cached switches (after a change in this isolate). */
export function clearAutomationControlsCache(): void {
  cache = null;
}

/** May an email tracked as `workflow` go out right now? Untracked and uncatalogued mail is never blocked. */
export async function automationAllowsEmail(workflow: string | undefined | null): Promise<boolean> {
  const key = settingKeyForEmailWorkflow(workflow);
  if (!key) return true;
  return isAutomationOn(await loadAutomationControls(), key);
}

// ---- Template previews ------------------------------------------------------
// previewCapture() runs a real template function with sample data; sendEmail
// sees the capture store, hands the rendered subject/html to it and returns
// without contacting Resend or writing a delivery row. Recovery links are
// replaced by a placeholder so no resume token is minted.

export type CapturedEmail = { to: string[]; subject: string; html: string; workflow: string | null };
type Store = { captured: CapturedEmail[] };
type Als = { getStore(): Store | undefined; run<T>(s: Store, f: () => T): T };
// Loaded on first preview (dynamic import keeps node:async_hooks out of any
// browser chunk that reaches this module); shared through globalThis.
const ALS_KEY = Symbol.for("real-rentals:automation-preview");
const g = globalThis as unknown as Record<symbol, Als | undefined>;

export function inPreview(): boolean {
  return g[ALS_KEY]?.getStore() !== undefined;
}

export function capturePreviewEmail(m: CapturedEmail): boolean {
  const s = g[ALS_KEY]?.getStore();
  if (!s) return false;
  s.captured.push(m);
  return true;
}

export async function previewCapture(run: () => Promise<unknown>): Promise<CapturedEmail[]> {
  if (!g[ALS_KEY]) {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    g[ALS_KEY] = new AsyncLocalStorage<Store>() as unknown as Als;
  }
  const store: Store = { captured: [] };
  await g[ALS_KEY]!.run(store, run);
  return store.captured;
}

export const PREVIEW_LINK = "https://drivereal.com/apply?resume=PREVIEW-LINK";
