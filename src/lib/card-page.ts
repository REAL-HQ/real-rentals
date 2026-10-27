/**
 * What the card page shows before any Stripe.js load.
 *
 * A missing credential, a bad or expired card token, and a signed-in user
 * who is not allowed to open this application all use one screen. The
 * checkout form is only for a session the server already accepted.
 */
export const CARD_LINK_EXPIRED_TITLE = "Link Expired";
export const CARD_LINK_EXPIRED_COPY =
  "This link is no longer valid. Ask us for a new one and we'll send it over.";

export type CardSessionProbe =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "expired" }
  | { status: "ready"; clientSecret: string }
  | { status: "error"; message: string };

export type CardScreen =
  | { kind: "wait" }
  | { kind: "expired"; title: typeof CARD_LINK_EXPIRED_TITLE; copy: typeof CARD_LINK_EXPIRED_COPY }
  | { kind: "saved" }
  | { kind: "form"; clientSecret: string }
  | { kind: "setup-error"; message: string };

const EXPIRED: CardScreen = {
  kind: "expired",
  title: CARD_LINK_EXPIRED_TITLE,
  copy: CARD_LINK_EXPIRED_COPY,
};

/** Map the server result onto a probe. The link sentence is the expired screen. */
export function probeFromSessionResult(
  result: { error: string } | { clientSecret: string },
): CardSessionProbe {
  if ("error" in result) {
    if (result.error === CARD_LINK_EXPIRED_COPY) return { status: "expired" };
    return { status: "error", message: result.error };
  }
  return { status: "ready", clientSecret: result.clientSecret };
}

/**
 * Choose the screen. `wait` renders nothing, so Stripe.js is not loaded
 * while the token or the signed-in session is still being checked.
 */
export function cardOnFileScreen(input: {
  isReturn: boolean;
  token: string | null | undefined;
  sessionState: "unknown" | "yes" | "no";
  probe: CardSessionProbe;
}): CardScreen {
  if (input.isReturn) return { kind: "saved" };
  if (input.token === undefined) return { kind: "wait" };
  if (!input.token && input.sessionState === "unknown") return { kind: "wait" };
  if (!input.token && input.sessionState === "no") return EXPIRED;
  if (input.probe.status === "idle" || input.probe.status === "pending") return { kind: "wait" };
  if (input.probe.status === "expired") return EXPIRED;
  if (input.probe.status === "error") return { kind: "setup-error", message: input.probe.message };
  return { kind: "form", clientSecret: input.probe.clientSecret };
}
