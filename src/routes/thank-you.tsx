import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
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
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1">
        <section className="pt-6 md:pt-10 pb-16 mx-auto px-4 sm:px-6 w-full max-w-5xl">
          <ApplicationWizard id={id} />
        </section>
      </main>
    </div>
  );
}
