import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { openResumeLink } from "@/lib/applications.functions";
import { ApplicationWizard } from "@/components/site/ApplicationWizard";
import { useResumeToken, storeResumeToken } from "@/lib/resume-token";
import { WelcomeBack } from "@/components/site/WelcomeBack";
import { thankYouView } from "@/lib/secure-link-copy";
import { Logo } from "@/components/site/Logo";
import { portalLoginUrl } from "@/lib/portal-handoff";

export const Route = createFileRoute("/thank-you")({
  // `t` is a resume token, not an application id. The id used to travel here
  // and was the only thing standing between a forwarded link and somebody
  // else's application; see src/lib/resume-tokens.server.ts.
  validateSearch: (s: Record<string, unknown>): { t?: string } => {
    const t = typeof s.t === "string" ? s.t.trim() : "";
    return t ? { t } : {};
  },
  head: () => ({
    meta: [
      { title: "Your Application — REAL RENTALS" },
      { name: "description", content: "Finish your REAL RENTALS driver application." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Your Application — REAL RENTALS" },
      { property: "og:description", content: "Finish your REAL RENTALS driver application." },
    ],
  }),
  component: ThankYouPage,
});

type OpenState =
  | { kind: "wait" }
  | { kind: "missing" }
  | { kind: "expired" }
  | { kind: "wizard"; token: string }
  | { kind: "approved"; email: string };

const exchanges = new Map<string, Promise<{ token: string | null; portal?: { email: string } | null }>>();

function ThankYouPage() {
  const { t } = Route.useSearch();
  // The token is stashed for this tab and stripped from the address bar, so
  // the credential is not sitting in history, screenshots or any third-party
  // script's view of location.href. See resume-token.client.ts.
  const raw = useResumeToken(t);
  const open = useServerFn(openResumeLink);
  const [state, setState] = useState<OpenState>({ kind: "wait" });

  useEffect(() => {
    if (raw === undefined) return;
    if (!raw) {
      setState({ kind: "missing" });
      return;
    }
    let live = true;
    // One request per link even if the effect re-runs (Strict Mode, remount):
    // a second request for a single-use link would find it already used.
    let pending = exchanges.get(raw);
    if (!pending) {
      pending = open({ data: { token: raw } });
      exchanges.set(raw, pending);
    }
    pending
      .then((r) => {
        if (!live) return;
        if (r.portal) {
          setState({ kind: "approved", email: r.portal.email || "" });
          return;
        }
        if (r.token && r.token !== raw) storeResumeToken(r.token);
        if (r.token) setState({ kind: "wizard", token: r.token });
        else setState({ kind: "expired" });
      })
      .catch(() => live && setState({ kind: "expired" }));
    return () => {
      live = false;
    };
  }, [raw, open]);

  const view =
    state.kind === "wait"
      ? thankYouView(undefined)
      : state.kind === "missing"
        ? thankYouView(null)
        : state.kind === "expired"
          ? thankYouView("")
          : state.kind === "approved"
            ? thankYouView(null, { email: state.email })
            : thankYouView(state.token);

  if (view === "wait") return null;
  if (view === "missing" || view === "expired") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-lg w-full">
          <WelcomeBack missing={view === "missing"} expired={view === "expired"} />
        </div>
      </div>
    );
  }

  if (view === "approved" && state.kind === "approved") {
    const href = portalLoginUrl(state.email || null);
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl border border-border bg-white p-8 text-center">
          <div className="flex justify-center">
            <Logo offset={false} />
          </div>
          <h1 className="mt-6 text-2xl font-semibold">You're Approved — Sign In To Your Account</h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            Your application is approved. Sign in to upload documents, sign your agreement, and finish setup. We'll
            email you a sign-in code — no password needed.
          </p>
          <Link
            to="/login"
            search={state.email ? ({ email: state.email } as any) : ({} as any)}
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-real-red text-white px-6 py-2.5 text-sm font-medium"
          >
            Sign In To Your Account
          </Link>
          <p className="mt-4 text-xs text-muted-foreground break-all">{href}</p>
        </div>
      </div>
    );
  }

  if (state.kind !== "wizard") return null;
  return (
    // Matches /apply: one logo, carried by the wizard's own panel.
    <div className="min-h-screen bg-background">
      <ApplicationWizard token={state.token} />
    </div>
  );
}
