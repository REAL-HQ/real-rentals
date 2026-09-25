import { createFileRoute, Navigate } from "@tanstack/react-router";
import { ApplicationWizard } from "@/components/site/ApplicationWizard";

export const Route = createFileRoute("/thank-you")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: (s.id as string) || "",
  }),
  head: () => ({
    meta: [
      { title: "Your Quote Request Is In — REAL RENTALS" },
      { name: "description", content: "Thanks for your request. Finish your profile to lock in your quote." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Your Quote Request Is In — REAL RENTALS" },
      { property: "og:description", content: "Thanks for your request. Finish your profile to lock in your quote." },
    ],
  }),
  component: ThankYouPage,
});

function ThankYouPage() {
  const { id } = Route.useSearch();

  if (!id) {
    return <Navigate to="/apply" />;
  }

  return (
    // Matches /apply: one logo, carried by the wizard's own panel.
    <div className="min-h-screen bg-background">
      <ApplicationWizard id={id} />
    </div>
  );
}
