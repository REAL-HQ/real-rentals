import { Package } from "lucide-react";

// Map internal platform keys → simpleicons.org slug + brand color.
// simpleicons.org CDN serves monochrome brand SVGs and supports a color query.
const MAP: Record<string, { slug: string; color: string; label: string }> = {
  uber: { slug: "uber", color: "000000", label: "Uber" },
  lyft: { slug: "lyft", color: "FF00BF", label: "Lyft" },
  doordash: { slug: "doordash", color: "FF3008", label: "DoorDash" },
  instacart: { slug: "instacart", color: "43B02A", label: "Instacart" },
  amazon: { slug: "amazon", color: "FF9900", label: "Amazon Flex" },
  "amazon flex": { slug: "amazon", color: "FF9900", label: "Amazon Flex" },
  spark: { slug: "walmart", color: "0071CE", label: "Spark" },
  shipt: { slug: "target", color: "CC0000", label: "Shipt" },
  grubhub: { slug: "grubhub", color: "F63440", label: "Grubhub" },
  favor: { slug: "postmates", color: "000000", label: "Favor" },
  roadie: { slug: "ups", color: "351C15", label: "Roadie" },
  veho: { slug: "fedex", color: "4D148C", label: "Veho" },
  goshare: { slug: "uhaul", color: "F26522", label: "GoShare" },
  other: { slug: "package", color: "6B7280", label: "Other" },
};

export function platformLabel(key: string): string {
  return MAP[key.toLowerCase()]?.label ?? key;
}

/**
 * PlatformLogo — renders a small brand mark for a gig platform.
 * Uses simpleicons.org CDN with brand color; falls back to a lucide icon.
 */
export function PlatformLogo({ platform, size = 14, className = "" }: {
  platform: string; size?: number; className?: string;
}) {
  const entry = MAP[platform.toLowerCase()];
  if (!entry || entry.slug === "package") {
    return <Package width={size} height={size} className={className} />;
  }
  return (
    <img
      src={`https://cdn.simpleicons.org/${entry.slug}/${entry.color}`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      className={`inline-block ${className}`}
      style={{ objectFit: "contain" }}
    />
  );
}