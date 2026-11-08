// Dispatch-time switches for Back Office → Automations. Server only.
//
// sendEmail asks automationAllowsEmail(workflow) before it does anything
// else, so every send path — cron, Stripe webhook, server function — honours
// the switch without each caller remembering to. The cron routes also call
// loadAutomationControls up front so a switched-off reminder is skipped
// before its dedupe row or bell notification is written.
//
// A missing row means nothing has been turned off (legacy default: on). A
// read error or malformed row is different: it HOLDS every catalogued send
// (fail closed) so an Owner's Off can never leak. Held emails are recorded as
// failed with a "Held:" reason and reported as retriable — never as sent.

import {
  AUTOMATION_CONTROLS_KEY,
  isAutomationOn,
  readAutomationControls,
  settingKeyForEmailWorkflow,
  type AutomationControlsState,
} from "@/lib/automation-catalog";

const CACHE_MS = 30_000;
let cache: { at: number; state: AutomationControlsState } | null = null;

type Reader = {
  from: (t: string) => {
    select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: { value: unknown } | null; error: unknown }> } };
  };
};

/** The stored switches. `fresh` skips the 30s cache. Failures are never cached. */
export async function loadAutomationControls(admin?: unknown, fresh = false): Promise<AutomationControlsState> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.state;
  let state: AutomationControlsState;
  try {
    const sb = (admin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin) as unknown as Reader;
    const { data, error } = await sb.from("app_settings").select("value").eq("key", AUTOMATION_CONTROLS_KEY).maybeSingle();
    if (error) state = { status: "error", value: null };
    else if (!data) state = { status: "absent", value: { off: {} } };
    else {
      const value = readAutomationControls(data.value);
      state = value ? { status: "ok", value } : { status: "error", value: null };
    }
  } catch {
    state = { status: "error", value: null };
  }
  if (state.status === "error") { cache = null; return state; }
  cache = { at: Date.now(), state };
  return state;
}

/** Forget the cached switches (after a change in this isolate). */
export function clearAutomationControlsCache(): void {
  cache = null;
}

/** "send" | "off" (Owner switched it off) | "held" (settings unreadable; retry later). */
export type GateDecision = "send" | "off" | "held";

export function gateFor(state: AutomationControlsState, key: string): GateDecision {
  if (state.status === "error") return "held";
  return isAutomationOn(state.value, key) ? "send" : "off";
}

/** Decision for an email tracked as `workflow`. Untracked and uncatalogued mail is never gated. */
export async function emailGate(workflow: string | undefined | null): Promise<GateDecision> {
  const key = settingKeyForEmailWorkflow(workflow);
  if (!key) return "send";
  return gateFor(await loadAutomationControls(), key);
}

/** Kept for callers that only need a yes/no. */
export async function automationAllowsEmail(workflow: string | undefined | null): Promise<boolean> {
  return (await emailGate(workflow)) === "send";
}

export const HELD_REASON = "Held: automation settings could not be read. Not sent.";

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
