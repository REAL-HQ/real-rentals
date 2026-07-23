import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type ScoreResult = {
  score: number;
  tier: "hot" | "warm" | "cold";
  flags: string[];
  summary: string;
};

const BUCKETS = {
  license: "license-uploads",
  profile: "profile-screenshots",
  trip: "profile-screenshots",
} as const;

function bucketAndPathFromUrl(url: string): { bucket: string; path: string } | null {
  // Accept either a raw storage path ("<uuid>/foo.jpg") or a Supabase public/sign URL
  if (!url) return null;
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  return null;
}

async function signImageForModel(
  supabaseAdmin: any,
  rawUrl: string | null | undefined,
  fallbackBucket: string,
): Promise<string | null> {
  if (!rawUrl) return null;
  let bucket = fallbackBucket;
  let path = rawUrl;
  const parsed = bucketAndPathFromUrl(rawUrl);
  if (parsed) {
    bucket = parsed.bucket;
    path = parsed.path;
  }
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 30);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function tierFromScore(n: number): "hot" | "warm" | "cold" {
  if (n >= 70) return "hot";
  if (n >= 40) return "warm";
  return "cold";
}

async function callScoringModel(payload: {
  row: Record<string, any>;
  images: { label: string; url: string }[];
}): Promise<ScoreResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");

  const rubric = `You are scoring a rideshare/delivery driver application for a rental company.

Rubric (total 100 pts):
- Trips completed: 25 pts (200–500 = 10, 500–1500 = 18, 1500+ = 25, <200 = 0)
- Rating: 20 pts (4.85+ = 20, 4.7–4.85 = 14, 4.5–4.7 = 8, below 4.5 = 0)
- Start timing: 20 pts (Today = 20, This week = 16, Within 2 weeks = 10, Just checking = 2)
- Completion depth: 15 pts (full wizard status "complete" = 15, otherwise prorate by current_step: eligibility=3, driver=7, vehicle=11, review=13)
- License valid + license photo uploaded: 10 pts (both true = 10, one = 5, none = 0)
- Screenshot verification: 10 pts. Read profile/trip screenshots. Do the visible trip count and rating look consistent with the claimed numbers? Consistent = 10, minor discrepancy = 5, major mismatch or unreadable = 0 and add a flag like "screenshot_mismatch" or "screenshot_unreadable".

Tiers: 70+ hot, 40-69 warm, below 40 cold.

Respond ONLY with strict JSON matching this shape (no prose, no markdown):
{ "score": <0-100 integer>, "tier": "hot"|"warm"|"cold", "flags": string[], "summary": "<2 sentence plain-english assessment>" }`;

  const claimSummary = {
    trips_completed: payload.row.trips_completed ?? null,
    rating: payload.row.rating ?? null,
    license_valid: payload.row.license_valid ?? null,
    license_photo_uploaded: !!payload.row.license_photo_url,
    start_timing: payload.row.start_timing ?? null,
    platforms: payload.row.platforms ?? null,
    market: payload.row.market ?? payload.row.city ?? null,
    pickup_date: payload.row.pickup_date ?? null,
    return_date: payload.row.return_date ?? null,
    status: payload.row.status ?? null,
    current_step: payload.row.current_step ?? null,
  };

  // Fetch each image and inline as base64 for Claude's vision input
  const imageBlocks = await Promise.all(
    payload.images.map(async (img) => {
      try {
        const r = await fetch(img.url);
        if (!r.ok) return null;
        const ct = r.headers.get("content-type") || "image/jpeg";
        const media_type = ct.split(";")[0].trim();
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        const b64 = btoa(bin);
        return {
          type: "image" as const,
          source: { type: "base64" as const, media_type, data: b64 },
        };
      } catch {
        return null;
      }
    }),
  );

  const userContent: any[] = [
    {
      type: "text",
      text: `Applicant claims:\n${JSON.stringify(claimSummary, null, 2)}\n\nAttached images (in order): ${payload.images.map((i) => i.label).join(", ") || "(none)"}\n\nScore now. Respond with strict JSON only.`,
    },
    ...imageBlocks.filter(Boolean),
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: rubric,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI scoring failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const content =
    json.content?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n") ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`AI scoring returned non-JSON: ${content.slice(0, 200)}`);
    parsed = JSON.parse(m[0]);
  }

  const rawScore = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  const flags: string[] = Array.isArray(parsed.flags)
    ? parsed.flags.filter((f: unknown) => typeof f === "string").slice(0, 12)
    : [];
  const summary: string = typeof parsed.summary === "string" ? parsed.summary.slice(0, 600) : "";
  const tier: "hot" | "warm" | "cold" =
    parsed.tier === "hot" || parsed.tier === "warm" || parsed.tier === "cold"
      ? parsed.tier
      : tierFromScore(rawScore);
  return { score: rawScore, tier, flags, summary };
}

async function requireAdmin(context: {
  supabase: any;
  userId: string;
}): Promise<void> {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const scoreApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return await runScoring(supabaseAdmin, data.id);
  });

/**
 * Server-only helper: run scoring for one application id. Used by the
 * admin server fn above and fire-and-forget from applications.functions
 * when a wizard is marked complete. Never throws to the caller — logs
 * and stamps null tier on failure so the applicant flow is never blocked.
 */
export async function runScoring(supabaseAdmin: any, id: string) {
  try {
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Application not found");

    const images: { label: string; url: string }[] = [];
    const license = await signImageForModel(supabaseAdmin, row.license_photo_url, BUCKETS.license);
    if (license) images.push({ label: "driver_license", url: license });
    const profile = await signImageForModel(supabaseAdmin, row.profile_screenshot_url, BUCKETS.profile);
    if (profile) images.push({ label: "gig_profile_screenshot", url: profile });
    const trips: string[] = Array.isArray(row.trip_screenshots) ? row.trip_screenshots : [];
    for (let i = 0; i < Math.min(trips.length, 4); i++) {
      const s = await signImageForModel(supabaseAdmin, trips[i], BUCKETS.trip);
      if (s) images.push({ label: `trip_screenshot_${i + 1}`, url: s });
    }

    let marketName: string | null = null;
    if (row.market_id) {
      const { data: m } = await supabaseAdmin
        .from("markets")
        .select("name")
        .eq("id", row.market_id)
        .maybeSingle();
      marketName = m?.name ?? null;
    }

    const result = await callScoringModel({
      row: { ...row, market: marketName },
      images,
    });

    await supabaseAdmin
      .from("applications")
      .update({
        ai_score: result.score,
        ai_tier: result.tier,
        ai_flags: result.flags,
        ai_summary: result.summary,
        scored_at: new Date().toISOString(),
      })
      .eq("id", id);

    return { ok: true as const, ...result };
  } catch (e) {
    console.error("[ai-scoring] failed", id, e);
    await supabaseAdmin
      .from("applications")
      .update({
        ai_tier: null,
        ai_summary: null,
        scored_at: new Date().toISOString(),
      })
      .eq("id", id);
    return { ok: false as const, error: e instanceof Error ? e.message : "scoring failed" };
  }
}