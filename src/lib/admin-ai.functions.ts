import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  year: z.number().int().min(1900).max(2100),
  make: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  color: z.string().min(1).max(40),
  body_type: z.string().min(1).max(40).optional().nullable(),
  trim: z.string().max(80).optional().nullable(),
});

export const generateVehicleImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const descriptor = [
      data.color,
      data.year,
      data.make,
      data.model,
      data.trim,
      data.body_type,
    ]
      .filter(Boolean)
      .join(" ");

    const prompt = `Professional studio product photograph of a ${descriptor}. Clean white seamless background, soft even lighting, sharp focus, 3/4 front angle, no people, no text, no watermark, no logo overlays, centered composition, e-commerce catalog style.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-image-2",
        prompt,
        quality: "low",
        size: "1024x1024",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Image generation failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = json.data?.[0];
    if (!first?.b64_json) {
      throw new Error("Image generation returned no image data");
    }
    return { b64: first.b64_json };
  });