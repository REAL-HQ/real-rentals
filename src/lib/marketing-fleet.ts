/**
 * The marketing fleet catalog.
 *
 * Two different things have been wearing one name on this site.
 *
 *   Marketing Fleet       — the kinds of vehicle REAL RENTALS rents. A small,
 *                           stable merchandising catalog. It exists so a paid
 *                           ad can land on a page that shows something.
 *   Live Fleet Inventory  — real, VIN-level units in `public.vehicles`. Owned
 *                           by the back office. Appears, disappears, and goes
 *                           out on rent every day.
 *
 * Until now the homepage had only the second one: it queried
 * `vehicles_public` for `status = 'available'` and rendered whatever came
 * back. With the operational table currently empty, every ad dollar landed on
 * an empty grid. (See git history — there was never a static marketing set
 * that got removed; the homepage has been coupled to inventory since the
 * first commit.)
 *
 * This module is the marketing half, and nothing else. It is deliberately a
 * typed static catalog rather than a table:
 *
 *   - It is six rarely-changing rows of merchandising copy, not operational
 *     data. A table would need RLS, grants, an admin editor, and a migration
 *     on a ledger that is already out of sync.
 *   - A catalog entry can never leak into Admin → Vehicles, the fleet
 *     snapshot, utilization, maintenance, expenses, P&L, GPS, insurance,
 *     registration, renter assignments, or availability counts, because it is
 *     not in the database at all. That boundary is structural, not a filter
 *     somebody has to remember to write.
 *   - The site already manages marketing vehicle types in code
 *     (`defaultVehicleTypes` in src/routes/$slug.tsx). This continues that.
 *
 * Rules this file keeps, enforced by scripts/marketing-fleet.test.mjs:
 *
 *   - A catalog `slug` is a slug. It is never a UUID and must never be passed
 *     anywhere a `vehicles.id` is expected.
 *   - No operational attribute lives here: no VIN, plate, GPS, insurance,
 *     registration, finance, keys, odometer, or maintenance.
 *   - No entry asserts availability. A representative vehicle type is not in
 *     stock; only a real unit can be. Live inventory may *add* an
 *     availability note to a card, but it never decides whether the card
 *     renders.
 *   - No price is invented. See `weeklyRateFrom` below.
 */

import corollaImg from "@/assets/cars/corolla.jpg.asset.json";
import accordImg from "@/assets/cars/accord.jpg.asset.json";
import crvImg from "@/assets/cars/crv.jpg.asset.json";
import rav4Img from "@/assets/cars/rav4.jpg.asset.json";
import odysseyImg from "@/assets/cars/odyssey.jpg.asset.json";
import siennaImg from "@/assets/cars/sienna.jpg.asset.json";

/** The three categories the public site has always merchandised. */
export type MarketingCategory = "sedan" | "suv" | "xl";

export const MARKETING_CATEGORIES: readonly MarketingCategory[] = ["sedan", "suv", "xl"];

export function isMarketingCategory(v: unknown): v is MarketingCategory {
  return typeof v === "string" && (MARKETING_CATEGORIES as readonly string[]).includes(v);
}

/**
 * The lowest weekly rate REAL RENTALS publishes. This is not read off a live
 * vehicle — it is the figure the site already advertises in two places:
 * the /fleet meta description ("From $350/week.") and the partner page
 * ("A $350/week rental pays you $175/week."). The original seeded sedans
 * priced at 350 as well.
 *
 * It is used only as a floor, and only on categories where that floor is
 * actually established. See `weeklyRateFrom`.
 */
export const PUBLISHED_WEEKLY_FLOOR = 350;

export type MarketingVehicle = {
  /**
   * Catalog key. A slug, never a UUID, and never a `vehicles.id`. It is used
   * for React keys and for campaign attribution in the apply URL.
   */
  slug: string;
  category: MarketingCategory;
  /** Short, distinct class name. The card headline. */
  title: string;
  /**
   * The representative models this class stands for. "& similar" is load
   * bearing: the catalog advertises a type, not a specific unit on the lot.
   */
  subtitle: string;
  /** One line of merchandising copy. */
  tagline: string;
  /** An approved image already in the repo. Nothing is generated here. */
  image: string;
  seats: number;
  doors: number;
  /**
   * Starting weekly rate, or null when REAL RENTALS has not published one for
   * this category.
   *
   * $350 is the established, already-published floor for sedans (see
   * PUBLISHED_WEEKLY_FLOOR). No comparable figure has ever been published for
   * SUVs or XL vehicles anywhere in this repo — the original seed contained
   * no SUV or XL rows at all — so those are null rather than guessed, and the
   * card says the rate is confirmed on the qualification call. Fill these in
   * when the real starting rates are decided; nothing else has to change.
   */
  weeklyRateFrom: number | null;
};

const GREAT_FOR: Record<MarketingCategory, string> = {
  // Matches the eligibility language already published on /fleet and the
  // homepage marquee. XL says UberXL/Lyft XL because a 7-seat minivan is what
  // those tiers are for — the same claim /fleet already makes.
  sedan: "Uber • Lyft • DoorDash • Instacart",
  suv: "Uber • Lyft • DoorDash • Instacart",
  xl: "UberXL • Lyft XL • Delivery",
};

export const CATEGORY_LABEL: Record<MarketingCategory, string> = {
  sedan: "Sedans",
  suv: "SUVs",
  xl: "XL Vehicles",
};

/**
 * The catalog. Six entries: two per category, which is what fills the
 * homepage grid at every breakpoint without a ragged last row.
 *
 * Copy and imagery are reused from what the site already ships. Nothing here
 * describes a vehicle REAL RENTALS does not rent.
 */
export const MARKETING_FLEET: readonly MarketingVehicle[] = [
  {
    slug: "compact-sedan",
    category: "sedan",
    title: "Compact Sedan",
    subtitle: "Toyota Corolla, Honda Civic & similar",
    tagline: "Efficient daily drivers. The lowest fuel cost per shift in the fleet.",
    image: corollaImg.url,
    seats: 5,
    doors: 4,
    weeklyRateFrom: PUBLISHED_WEEKLY_FLOOR,
  },
  {
    slug: "midsize-sedan",
    category: "sedan",
    title: "Midsize Sedan",
    subtitle: "Honda Accord, Toyota Camry & similar",
    tagline: "More legroom and trunk space for longer rides and bigger orders.",
    image: accordImg.url,
    seats: 5,
    doors: 4,
    weeklyRateFrom: PUBLISHED_WEEKLY_FLOOR,
  },
  {
    slug: "compact-suv",
    category: "suv",
    title: "Compact SUV",
    subtitle: "Honda CR-V & similar",
    tagline: "Cargo room for delivery work without a full-size fuel bill.",
    image: crvImg.url,
    seats: 5,
    doors: 4,
    weeklyRateFrom: null,
  },
  {
    slug: "midsize-suv",
    category: "suv",
    title: "Midsize SUV",
    subtitle: "Toyota RAV4 & similar",
    tagline: "More room for drivers who need flexible cargo space.",
    image: rav4Img.url,
    seats: 5,
    doors: 4,
    weeklyRateFrom: null,
  },
  {
    slug: "xl-minivan",
    category: "xl",
    title: "XL Minivan",
    subtitle: "Honda Odyssey & similar",
    tagline: "Seven seats for airport runs, groups, and higher-capacity trips.",
    image: odysseyImg.url,
    seats: 7,
    doors: 4,
    weeklyRateFrom: null,
  },
  {
    slug: "xl-passenger",
    category: "xl",
    title: "XL Passenger",
    subtitle: "Toyota Sienna & similar",
    tagline: "Maximum passenger and cargo capacity for XL platform work.",
    image: siennaImg.url,
    seats: 7,
    doors: 4,
    weeklyRateFrom: null,
  },
];

export function marketingFleetByCategory(category: MarketingCategory): MarketingVehicle[] {
  return MARKETING_FLEET.filter((v) => v.category === category);
}

/* -------------------------------------------------------------------------
 * The card view model.
 *
 * A catalog entry and a live vehicle are not the same entity and this file
 * does not pretend otherwise. They do, however, merchandise the same way, so
 * each projects into one neutral shape that the card renders. The card never
 * sees a `Tables<"vehicles_public">` row and never sees a MarketingVehicle.
 * ---------------------------------------------------------------------- */

/** Where a card navigates. Kept as a tagged union so the Link stays typed. */
export type PublicVehicleHref =
  | { kind: "vehicle"; id: string }
  | { kind: "category"; type: MarketingCategory }
  | { kind: "apply"; type: MarketingCategory };

export type PublicVehicleCardModel = {
  key: string;
  /** "catalog" is a representative type. "inventory" is one real unit. */
  kind: "catalog" | "inventory";
  title: string;
  subtitle: string | null;
  image: string | null;
  /** Rendered verbatim in the price slot. Never a bare number. */
  priceLabel: string;
  greatFor: string;
  bodyTypeLabel: string;
  seatsLabel: string;
  doorsLabel: string;
  fuel: "gas" | "hybrid" | "ev";
  /** Shown only when the fuel badge would be less useful than range. */
  rangeLabel: string | null;
  eligibility: string | null;
  /**
   * Only ever set from real inventory. A catalog card leaves this null rather
   * than implying stock it cannot prove.
   */
  availabilityNote: string | null;
  href: PublicVehicleHref;
  ctaHref: string;
};

/**
 * `linkTo` picks where the whole card navigates.
 *
 *   "category" — the default, for cards shown off the fleet page. Lands on
 *                /fleet filtered to this category.
 *   "apply"    — for cards shown ON the fleet page, where "see this category
 *                on /fleet" is a link back to the page you are already
 *                standing on. Dead navigation is worse than no link, so
 *                there the card is the call to action.
 */
export function catalogCardModel(
  v: MarketingVehicle,
  linkTo: "category" | "apply" = "category",
): PublicVehicleCardModel {
  return {
    key: `catalog:${v.slug}`,
    kind: "catalog",
    title: v.title,
    subtitle: v.subtitle,
    image: v.image,
    priceLabel:
      v.weeklyRateFrom === null ? "Rate confirmed on your call" : `From $${v.weeklyRateFrom}/week`,
    greatFor: GREAT_FOR[v.category],
    bodyTypeLabel: CATEGORY_LABEL[v.category],
    seatsLabel: String(v.seats),
    doorsLabel: String(v.doors),
    fuel: "gas",
    rangeLabel: null,
    eligibility: null,
    // Always null. A representative type cannot be in stock, and a per-card
    // count would be read as a claim about that specific class — "3 available
    // now" on the Compact Sedan card when the three on the lot are midsize is
    // a lie by placement. Live counts belong at the section level, where they
    // are unambiguous. See liveAvailabilityNote().
    availabilityNote: null,
    href: { kind: linkTo, type: v.category },
    // A catalog entry is not a vehicle id. The apply URL carries the category
    // it came from, which is true, and which attribution can read.
    ctaHref: `/apply?vehicle_type=${v.category}`,
  };
}

/**
 * The one place live inventory is allowed to speak on a marketing surface.
 *
 * Semantics, deliberately narrow:
 *
 *   - A category is named only when at least one REAL unit of that body type
 *     is marked available by the back office. Nothing is inferred from the
 *     catalog's existence.
 *   - The claim is made about the CATEGORY, in category words ("Sedans"), and
 *     it is rendered beside the section heading rather than on a card. Put a
 *     count on the Compact Sedan card and it reads as a claim about compact
 *     sedans — when the one free sedan is a midsize, that is a lie by
 *     placement. Two cards share a category; a card cannot carry a category
 *     claim honestly.
 *   - Nothing is said about a category with zero available. No "0 available",
 *     no "out of stock", no scarcity. Silence is the neutral state.
 *   - Everything empty returns null and no line renders at all.
 */
export function liveAvailabilityNote(
  counts: Partial<Record<MarketingCategory, number>>,
): string | null {
  const live = MARKETING_CATEGORIES.filter((c) => {
    const n = counts[c];
    return typeof n === "number" && Number.isFinite(n) && n > 0;
  });
  if (live.length === 0) return null;
  return `Available now: ${live.map((c) => CATEGORY_LABEL[c]).join(" · ")}`;
}
