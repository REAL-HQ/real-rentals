import { useEffect, useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { openResumeLink } from "@/lib/applications.functions";
import { ApplicationWizard } from "@/components/site/ApplicationWizard";
import { useResumeToken, storeResumeToken } from "@/lib/resume-token";
import { WelcomeBack } from "@/components/site/WelcomeBack";

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

const exchanges = new Map<string, Promise<{ token: string | null }>>();

function ThankYouPage() {
  const { t } = Route.useSearch();
  // The token is stashed for this tab and stripped from the address bar, so
  // the credential is not sitting in history, screenshots or any third-party
  // script's view of location.href. See resume-token.client.ts.
  const raw = useResumeToken(t);
  const open = useServerFn(openResumeLink);
  // Exchange once per page load: a single-use recovery link becomes a session
  // token for this tab; ordinary links come back unchanged.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (raw === undefined) return;
    if (!raw) return setToken(null);
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
        if (r.token && r.token !== raw) storeResumeToken(r.token);
        setToken(r.token ?? "");
      })
      .catch(() => live && setToken(""));
    return () => {
      live = false;
    };
  }, [raw, open]);

  if (token === undefined) return null;
  if (token === null) return <Navigate to="/apply" />;
  if (token === "") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-lg w-full">
          <WelcomeBack expired />
        </div>
      </div>
    );
  }

  return (
    // Matches /apply: one logo, carried by the wizard's own panel.
    <div className="min-h-screen bg-background">
      <ApplicationWizard token={token} />
    </div>
  );
}
