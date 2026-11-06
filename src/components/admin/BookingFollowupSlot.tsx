import { useEffect, useState, type ComponentType } from "react";
import { BOOKING_FOLLOWUP_ENABLED } from "@/lib/booking-followup";

/** Empty while the flag is off. The panel chunk is not requested. */
export function BookingFollowupSlot() {
  const [Panel, setPanel] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (BOOKING_FOLLOWUP_ENABLED !== true) return;
    void import("@/components/admin/BookingFollowupPanel").then((mod) => {
      setPanel(() => mod.BookingFollowupPanel);
    });
  }, []);
  if (BOOKING_FOLLOWUP_ENABLED !== true || !Panel) return null;
  return <Panel />;
}
