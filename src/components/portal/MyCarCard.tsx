import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import type { MyCarCard as MyCarCardData } from "@/lib/my-car-card";

/**
 * Read-only. Mounted only while MY_CAR_CARD_ENABLED is true, so this query
 * does not run while the flag is off.
 */
export function MyCarCard({
  read,
  onPayments,
  onDocuments,
}: {
  read: () => Promise<MyCarCardData | null>;
  onPayments: () => void;
  onDocuments: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-car-card"],
    queryFn: () => read(),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) {
    return <p className="text-sm text-real-red">{error instanceof Error ? error.message : "Could not load your car."}</p>;
  }
  if (!data) return null;

  const name = [data.year, data.make, data.model].filter((part) => part != null && String(part).trim()).join(" ");
  const photo = resolvePhotoUrl(data.photo);

  return (
    <section className="rounded-2xl border border-border bg-white overflow-hidden">
      <div className="aspect-[16/9] bg-soft">
        {photo ? <img src={photo} alt={name || "Your car"} className="h-full w-full object-cover" /> : null}
      </div>
      <div className="p-5">
        <h2 className="text-sm font-semibold">My Car</h2>
        {name ? <p className="mt-2 text-xl font-semibold">{name}</p> : null}
        {data.color ? <p className="mt-1 text-sm text-muted-foreground">{data.color}</p> : null}
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.startDate ? (
            <div>
              <dt className="text-xs text-muted-foreground">Start Date</dt>
              <dd className="mt-0.5 text-sm">{data.startDate}</dd>
            </div>
          ) : null}
          {data.weeklyRate ? (
            <div>
              <dt className="text-xs text-muted-foreground">Weekly Rate</dt>
              <dd className="mt-0.5 text-sm">{data.weeklyRate}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {data.links.map((link) =>
            link.tab === "payments" ? (
              <button
                key={link.label}
                type="button"
                onClick={onPayments}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-real-red px-4 text-sm font-medium text-white sm:w-auto"
              >
                Payments
              </button>
            ) : link.tab === "documents" ? (
              <button
                key={link.label}
                type="button"
                onClick={onDocuments}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 text-sm font-medium sm:w-auto"
              >
                Documents
              </button>
            ) : link.href === "/portal/roadside" ? (
              <Link
                key={link.label}
                to="/portal/roadside"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 text-sm font-medium sm:w-auto"
              >
                {link.label}
              </Link>
            ) : (
              <p key={link.label} className="inline-flex min-h-11 items-center text-sm text-muted-foreground">
                Not Linked: {link.label}
              </p>
            ),
          )}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Not Shown: Plate</p>
        {data.missing.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Not Recorded: {data.missing.join(", ")}</p>
        ) : null}
      </div>
    </section>
  );
}
