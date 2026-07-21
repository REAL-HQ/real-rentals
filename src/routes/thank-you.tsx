import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { FadeUp } from "@/components/site/FadeUp";
import { ApplicationWizard } from "@/components/site/ApplicationWizard";
import { CheckCircle2 } from "lucide-react";

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
    return <Navigate to="/" />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1">
        <section className="pt-12 md:pt-20 pb-8 mx-auto px-6 w-full max-w-[1600px]">
          <FadeUp>
            <div className="max-w-2xl mx-auto rounded-2xl border border-real-red/20 bg-real-red/5 p-6 md:p-8 text-center">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-real-red/10 text-real-red">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h1 className="mt-4 text-2xl md:text-3xl font-semibold">Your Quote Request Is In</h1>
              <p className="mt-2 text-muted-foreground">
                Thanks — we've saved your info. Finish the quick profile below so we can match you with the right vehicle and get back to you fast.
              </p>
            </div>
          </FadeUp>
        </section>
        <section className="pb-24 mx-auto px-6 w-full max-w-[1600px]">
          <ApplicationWizard id={id} />
        </section>
      </main>
    </div>
  );
}