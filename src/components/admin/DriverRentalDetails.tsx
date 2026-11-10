import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBooking, type BookingDetail } from "@/lib/bookings.functions";
import { fmtDate } from "@/lib/date-format";
import { driverRentalFacts } from "./driver-rental-details";

export function DriverRentalDetails({ rentalId, applicationId, lookupLoading, lookupFailed }: {
  rentalId: string | null;
  applicationId: string;
  lookupLoading: boolean;
  lookupFailed: boolean;
}) {
  const load = useServerFn(getBooking);
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setFailed(false);
    setLoading(!!rentalId);
    if (rentalId) {
      load({ data: { rentalId } }).then((result) => {
        if (cancelled) return;
        setDetail(result);
        setFailed(!result || !driverRentalFacts(result, applicationId));
      }).catch(() => { if (!cancelled) setFailed(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [rentalId, applicationId, load, attempt]);

  const facts = detail ? driverRentalFacts(detail, applicationId) : null;
  const miles = (value: number | null) => value == null ? "Not Recorded" : `${value.toLocaleString("en-US")} mi`;
  const usd = (value: number | null) => value == null ? "Not Set" : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const items: { label: string; value: string }[] = facts ? [
    { label: "Vehicle", value: facts.vehicle },
    { label: "Status", value: facts.status ? facts.status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not Recorded" },
    { label: "Start Date", value: facts.startDate ? fmtDate(facts.startDate) : "Not Recorded" },
    { label: "End Date", value: facts.endDate ? fmtDate(facts.endDate) : facts.openEnded ? "Open-Ended" : "Not Recorded" },
    { label: "Mileage Out", value: miles(facts.mileageOut) },
    { label: "Mileage In", value: facts.mileageIn == null && facts.active ? "Pending Return" : miles(facts.mileageIn) },
    ...(facts.money ? [
      { label: "Weekly Rate", value: usd(facts.money.weeklyRate) },
      { label: "Deposit", value: usd(facts.money.deposit) },
    ] : []),
  ] : [];

  return <section aria-label="Rental Details" className="mt-5 border-t border-border pt-4">
    <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><CalendarDays className="h-4 w-4 text-muted-foreground" />Rental Details</h3>
    {lookupLoading || loading ? <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading Rental Details…</div>
      : lookupFailed || failed ? <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">Rental Details Unavailable{rentalId && <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>}</div>
      : !facts ? <p className="text-sm text-muted-foreground">No Rental Recorded</p>
      : <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">{items.map(({ label, value }) => <div key={label} className="min-w-0">
        <dt className="mb-1 text-xs text-muted-foreground">{label}</dt><dd className="break-words text-sm font-medium text-foreground">{value}</dd>
      </div>)}</dl>}
  </section>;
}