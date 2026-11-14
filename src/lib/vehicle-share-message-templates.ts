/** Optional staff drafts only; applying a template never creates or sends a package. */
export const VEHICLE_SHARE_MESSAGE_TEMPLATES = [
  {
    id: "photos",
    label: "Vehicle Photos",
    message: "Hi! Here are the vehicle photos you requested. Open the secure link below to take a look. Let our team know if you have any questions. — REAL RENTALS",
  },
  {
    id: "insurance",
    label: "Insurance Details",
    message: "Hi! Here are the vehicle photos and details for your insurance provider. Open the secure link below to review the package. Let our team know if your provider needs anything else. — REAL RENTALS",
  },
  {
    id: "preview",
    label: "Vehicle Preview",
    message: "Hi! Take a look at this vehicle before pickup using the secure link below. Vehicle assignment will be confirmed by our team. Let us know if you have any questions. — REAL RENTALS",
  },
] as const;