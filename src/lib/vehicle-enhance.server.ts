// The photo-enhancement adapter.
//
// No provider is wired. That is the current state of the system, not an
// oversight, and this file exists so that plugging one in later is a small,
// reviewable change rather than a new subsystem invented under time pressure.
//
// ---------------------------------------------------------------------------
// The contract, and why it is shaped this way
//
// An enhancement takes THE PHOTOGRAPH and returns THE SAME PHOTOGRAPH, better
// lit. It is image-to-image editing. It is never text-to-image generation.
//
// That distinction is the whole point. A generator given "silver 2021 Toyota
// Camry" returns a beautiful silver Camry that is not your silver Camry: not
// your dent, not your wheels, not your plate. Putting that on a listing tells
// a driver they are renting a car we do not have. So `enhance` receives bytes
// and must return bytes derived from them; a provider that cannot accept an
// input image cannot implement this interface.
//
// The repository already contained exactly that mistake — a "Generate with AI"
// button calling a text-to-image model and writing the result straight into
// vehicles.photos, which feeds the public fleet page. It was removed in the
// same change that added this file.
//
// ---------------------------------------------------------------------------
// What enhancement may never touch
//
// Inspection and damage evidence lives in `condition_media`, a different table
// with a different purpose. Nothing here reads or writes it, and the enhance
// path accepts only a `vehicle_media` row of kind 'original'. A retouched
// photograph is not evidence of anything, and the moment it could be filed as
// evidence, every genuine photo becomes arguable too.

export const ENHANCEMENT_MODES = [
  {
    value: "clean_background",
    label: "Clean background",
    hint: "Tidy the surroundings, keep the car exactly as photographed.",
  },
  { value: "studio", label: "Studio", hint: "Neutral seamless backdrop and even lighting." },
  { value: "outdoor", label: "Outdoor", hint: "Natural daylight, plain setting." },
  {
    value: "dealer_listing",
    label: "Dealer listing",
    hint: "Bright, high-contrast, catalogue style.",
  },
] as const;

export type EnhancementMode = (typeof ENHANCEMENT_MODES)[number]["value"];

export type EnhanceRequest = {
  /** The original photograph. Required — there is no prompt-only path. */
  source: Uint8Array;
  sourceMimeType: string;
  mode: EnhancementMode;
  /** Context a provider may use for prompting. Never a substitute for the image. */
  subject?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    color?: string | null;
  };
};

export type EnhanceResult = {
  bytes: Uint8Array;
  mimeType: string;
  /** Recorded on the derivative row so a listing image can be traced to its tool. */
  provider: string;
};

export type EnhanceProvider = {
  name: string;
  /** False when the provider's credentials are absent. Checked before any work. */
  configured: () => boolean;
  enhance: (req: EnhanceRequest) => Promise<EnhanceResult>;
};

/**
 * Providers, in preference order.
 *
 * Empty on purpose. To add one, append an object implementing EnhanceProvider
 * whose `enhance` sends `req.source` to an image-EDITING endpoint and returns
 * what comes back. Do not add a text-to-image model here; it cannot satisfy
 * the contract above, and `assertEditsTheSourceImage` below is a reminder, not
 * a substitute for reading it.
 */
const PROVIDERS: EnhanceProvider[] = [];

export function activeProvider(): EnhanceProvider | null {
  return PROVIDERS.find((p) => p.configured()) ?? null;
}

export type EnhancementAvailability = {
  available: boolean;
  provider: string | null;
  /** Shown to the operator verbatim, so "why is this greyed out" has an answer. */
  reason: string;
};

export function enhancementAvailability(): EnhancementAvailability {
  if (!PROVIDERS.length) {
    return {
      available: false,
      provider: null,
      reason:
        "No photo-enhancement provider is connected. Enhancement needs a model that edits the " +
        "photograph you took — not one that generates a picture of a similar car — so the listing " +
        "still shows the actual vehicle.",
    };
  }
  const p = activeProvider();
  return p
    ? { available: true, provider: p.name, reason: `Using ${p.name}.` }
    : {
        available: false,
        provider: null,
        reason: `A provider is registered (${PROVIDERS.map((x) => x.name).join(", ")}) but its credentials are missing.`,
      };
}

/** Guard for provider implementations: an enhancement without a source is a generation. */
export function assertEditsTheSourceImage(req: EnhanceRequest): void {
  if (!req.source || req.source.byteLength === 0) {
    throw new Error(
      "Enhancement requires the original image. A provider that generates from a description " +
        "would return a different car.",
    );
  }
}

export async function enhance(req: EnhanceRequest): Promise<EnhanceResult> {
  const provider = activeProvider();
  if (!provider) throw new Error(enhancementAvailability().reason);
  assertEditsTheSourceImage(req);
  return provider.enhance(req);
}
