import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { SectionCard } from "./ui";
import { getPhotoStudioStatus, savePhotoStudioSettings } from "@/lib/photo-studio.functions";

/** Owner-only switch and caps for AI marketing photos. Off by default. */
export function PhotoStudioSettingsCard() {
  const status = useServerFn(getPhotoStudioStatus);
  const save = useServerFn(savePhotoStudioSettings);
  const [st, setSt] = useState<Awaited<ReturnType<typeof getPhotoStudioStatus>> | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [daily, setDaily] = useState(60);
  const [capDollars, setCap] = useState(100);
  useEffect(() => { void status().then((s) => { setSt(s); setEnabled(s.enabled); setDaily(s.dailyImageLimit); setCap(s.monthlyCapCents / 100); }); }, [status]);
  if (!st) return null;
  return (
    <SectionCard title="AI Photo Studio" subtitle="Generates template marketing shots for each car with Google Gemini. Every shot needs a person's approval; only the Owner can put a car's shots on the website.">
      <p className="text-xs text-muted-foreground mb-2">This month ${(st.usage.monthCents / 100).toFixed(2)} spent · about $0.30–0.40 per car · model {st.model}{st.configured ? "" : " · provider key not configured"}</p>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm"><Switch checked={enabled} disabled={!st.canConfigure} onCheckedChange={setEnabled} /> On</label>
        <label className="text-sm">Images Per Day <Input type="number" className="w-24 inline-block" value={daily} disabled={!st.canConfigure} onChange={(e) => setDaily(Number(e.target.value))} /></label>
        <label className="text-sm">Monthly Cap ($) <Input type="number" className="w-24 inline-block" value={capDollars} disabled={!st.canConfigure} onChange={(e) => setCap(Number(e.target.value))} /></label>
        {st.canConfigure && <Button size="sm" onClick={async () => {
          const r = await save({ data: { enabled, dailyImageLimit: Math.round(daily), monthlyCapCents: Math.round(capDollars * 100) } });
          r.ok ? toast.success("Saved.") : toast.error(r.error);
        }}>Save</Button>}
      </div>
    </SectionCard>
  );
}
