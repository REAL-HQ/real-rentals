import { createFileRoute, Navigate } from "@tanstack/react-router";
import { ApplicationWizard } from "@/components/site/ApplicationWizard";
import { useResumeToken } from "@/lib/resume-token";

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

function ThankYouPage() {
  const { t } = Route.useSearch();
  // The token is stashed for this tab and stripped from the address bar, so
  // the credential is not sitting in history, screenshots or any third-party
  // script's view of location.href. See resume-token.client.ts.
  const token = useResumeToken(t);

  if (token === undefined) return null;
  if (!token) {
    return <Navigate to="/apply" />;
  }

  return (
    // Matches /apply: one logo, carried by the wizard's own panel.
    <div className="min-h-screen bg-background">
      <ApplicationWizard token={token} />
    </div>
  );
}
