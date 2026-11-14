import { CalendarClock, Car, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PickupPacket } from "@/lib/pickup-plan";

/** Shared reviewed snapshot. Not mounted on live portal until durable support is accepted. */
export function PortalPickupPlan({ packet, showLinks = true }: { packet: PickupPacket | null; showLinks?: boolean }) {
  if (!packet) return <section aria-label="Pickup Details"><h3 className="text-base font-semibold text-foreground">Pickup Details</h3><p className="mt-2 text-sm text-muted-foreground">Appointment Not Confirmed</p></section>;
  const appointment = new Intl.DateTimeFormat("en-US", { timeZone: packet.timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(packet.appointmentAt));
  const links = [
    { label: "Back Office", href: packet.portalUrl }, { label: "Agreement", href: packet.agreementUrl },
    { label: "Payment", href: packet.paymentUrl }, { label: "Vehicle Photos", href: packet.photoPackageUrl },
  ];
  return <section aria-label="Pickup Details" className="space-y-4">
    <h3 className="text-base font-semibold text-foreground">Pickup Details</h3>
    <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
      <div><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />Appointment</dt><dd className="mt-1 font-medium text-foreground">{appointment}</dd><dd className="text-xs text-muted-foreground">{packet.timeZone}</dd></div>
      <div><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" />Location</dt><dd className="mt-1 break-words text-foreground">{packet.location}</dd></div>
      <div className="sm:col-span-2"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Car className="h-3.5 w-3.5" />Assigned Vehicle</dt><dd className="mt-1 font-medium text-foreground">{packet.vehicle.label}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Plate</dt><dd className="mt-1 font-mono text-foreground">{packet.vehicle.plate}</dd></div>
      <div><dt className="text-xs text-muted-foreground">VIN</dt><dd className="mt-1 break-all font-mono text-foreground">{packet.vehicle.vin}</dd></div>
      <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Registration</dt><dd className="mt-1 break-words text-foreground">{packet.vehicle.registration}</dd></div>
    </dl>
    {showLinks ? <div className="flex flex-wrap gap-2">{links.map((link) => link.href ? <Button key={link.label} asChild variant="outline" size="sm"><a href={link.href}>{link.label}</a></Button> : null)}</div> : null}
  </section>;
}