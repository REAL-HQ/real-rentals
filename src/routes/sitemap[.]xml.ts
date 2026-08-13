import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

const BASE_URL = "https://drivereal.com";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/fleet", changefreq: "weekly", priority: "0.9" },
          { path: "/how-it-works", changefreq: "monthly", priority: "0.7" },
          { path: "/faq", changefreq: "monthly", priority: "0.6" },
          { path: "/contact", changefreq: "monthly", priority: "0.6" },
          { path: "/apply", changefreq: "monthly", priority: "0.8" },
          { path: "/partner", changefreq: "monthly", priority: "0.6" },
          { path: "/partners", changefreq: "monthly", priority: "0.6" },
          { path: "/investor-faq", changefreq: "monthly", priority: "0.4" },
          { path: "/privacy", changefreq: "yearly", priority: "0.3" },
          { path: "/terms", changefreq: "yearly", priority: "0.3" },
          { path: "/sms-consent", changefreq: "yearly", priority: "0.3" },
        ];

        try {
          const { data: sites } = await supabase
            .from("sites")
            .select("slug")
            .eq("is_published", true);
          for (const s of sites ?? []) {
            if (s.slug) entries.push({ path: `/${s.slug}`, changefreq: "weekly", priority: "0.8" });
          }
        } catch {
          // City pages are omitted when the database is unreachable.
        }

        try {
          const { data: vehicles } = await supabase.from("vehicles").select("id");
          for (const v of vehicles ?? []) {
            entries.push({ path: `/fleet/${v.id}`, changefreq: "weekly", priority: "0.6" });
          }
        } catch {
          // Vehicle pages are omitted when the database is unreachable.
        }

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
