import { createFileRoute } from "@tanstack/react-router";
import { getSharedVehiclePackage } from "@/lib/vehicle-share.functions";
import { fmtDateTime } from "@/lib/date-format";
import { VEHICLE_SHARE_TOKEN_RE } from "@/lib/vehicle-share";

const TOKEN = VEHICLE_SHARE_TOKEN_RE;

export const Route = createFileRoute("/share/vehicle/$token")({
  head: () => ({
    meta: [
      { title: "Shared Vehicle Package | REAL RENTALS" },
      { name: "description", content: "A private, expiring REAL RENTALS vehicle photo and insurance-details package." },
      { property: "og:title", content: "Shared Vehicle Package | REAL RENTALS" },
      { property: "og:description", content: "Review the vehicle photos and details shared with you by REAL RENTALS." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  loader: async ({ params }) => TOKEN.test(params.token)
    ? getSharedVehiclePackage({ data: { token: params.token } })
    : null,
  component: SharedVehiclePage,
});

function SharedVehiclePage() {
  const pkg = Route.useLoaderData();
  const { token } = Route.useParams();
  if (!pkg) {
    return (
      <main className="grid min-h-screen place-items-center bg-soft px-6 text-foreground">
        <section className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="text-sm font-bold tracking-wide text-brand">REAL RENTALS</div>
          <h1 className="mt-4 text-2xl font-semibold">Package Unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">This private sharing link is invalid, expired, or no longer available. Ask the REAL RENTALS team for a new link.</p>
        </section>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-soft px-4 py-6 text-foreground sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="text-sm font-bold tracking-wide text-brand">REAL RENTALS</div>
          <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">{pkg.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{pkg.photoIds.length} photo{pkg.photoIds.length === 1 ? "" : "s"}{pkg.details ? " · Vehicle and registration details" : ""}</p>
          <p className="mt-3 text-xs text-muted-foreground">Private Link Expires: {fmtDateTime(pkg.expiresAt)}.</p>
        </header>

        {pkg.details && (
          <section aria-label="Vehicle Details" className="mt-5 grid gap-4 sm:grid-cols-2">
            {pkg.details.sections.map((section) => (
              <article key={section.heading} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <h2 className="text-base font-semibold">{section.heading}</h2>
                <dl className="mt-4 space-y-3">
                  {section.rows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 text-sm">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="break-words font-medium">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </section>
        )}

        <section aria-label="Vehicle Photos" className="mt-5 grid gap-4 sm:grid-cols-2">
          {pkg.photoIds.map((id, index) => (
            <img
              key={id}
              src={`/share/vehicle-photo/${token}/${id}`}
              alt={`${pkg.title} photo ${index + 1}`}
              loading={index < 2 ? "eager" : "lazy"}
              className="aspect-[4/3] w-full rounded-2xl border border-border bg-card object-cover shadow-sm"
            />
          ))}
        </section>
      </div>
    </main>
  );
}
