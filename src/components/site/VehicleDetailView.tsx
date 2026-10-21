import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SiteLayout } from "@/components/site/SiteLayout";
import {
  PUBLIC_VEHICLE_DETAIL_COLUMNS,
  presentPublicVehicle,
  type VehicleDetailResult,
} from "@/lib/vehicle-detail";

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let el = document.head.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function VehicleDetailView({ id }: { id: string }) {
  const [state, setState] = useState<"loading" | VehicleDetailResult>("loading");
  const [photoIndex, setPhotoIndex] = useState(0);

  useEffect(() => {
    let active = true;
    setState("loading");
    setPhotoIndex(0);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("vehicles_public")
          .select(PUBLIC_VEHICLE_DETAIL_COLUMNS)
          .eq("id", id)
          .maybeSingle();
        if (!active) return;
        setState(presentPublicVehicle(error || !data ? null : (data as Record<string, unknown>), Boolean(error)));
      } catch {
        if (active) setState({ kind: "missing" });
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (state === "loading") return;
    const title = state.kind === "missing" ? "Vehicle Not Available — REAL RENTALS" : state.vehicle.metaTitle;
    const description =
      state.kind === "missing" ? "This vehicle is no longer listed." : state.vehicle.metaDescription;
    document.title = title;
    setMeta("description", description);
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
  }, [state]);

  if (state === "loading") {
    return (
      <SiteLayout>
        <div className="container-real px-4 py-16 text-center text-muted-foreground">Loading…</div>
      </SiteLayout>
    );
  }

  if (state.kind === "missing") {
    return (
      <SiteLayout>
        <section className="container-real px-4 py-16 text-center">
          <h1 className="text-3xl font-semibold">Vehicle Not Available</h1>
          <p className="mt-3 text-muted-foreground">This vehicle is no longer listed.</p>
          <Link
            to="/fleet"
            className="mt-8 inline-flex min-h-11 items-center justify-center rounded-lg bg-real-red px-6 text-sm font-medium text-white"
          >
            Back To Fleet
          </Link>
        </section>
      </SiteLayout>
    );
  }

  const vehicle = state.vehicle;
  const photo = vehicle.photos[photoIndex] ?? vehicle.photos[0] ?? null;

  return (
    <SiteLayout>
      <section className="container-real px-4 pt-6 pb-10 md:pt-12">
        <Link to="/fleet" className="inline-flex min-h-11 items-center text-sm text-muted-foreground">
          Back To Fleet
        </Link>

        <div className="mt-2 overflow-hidden rounded-2xl bg-soft">
          {photo ? (
            <img src={photo.src} alt={photo.alt} className="aspect-[4/3] w-full object-cover" />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center text-sm text-muted-foreground">No Photo Listed</div>
          )}
        </div>

        {vehicle.photos.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {vehicle.photos.map((item, index) => (
              <button
                key={`${item.src}-${index}`}
                type="button"
                aria-label={`Photo ${index + 1}`}
                aria-pressed={index === photoIndex}
                onClick={() => setPhotoIndex(index)}
                className={`min-h-11 min-w-11 shrink-0 overflow-hidden rounded-lg border ${index === photoIndex ? "border-foreground" : "border-transparent"}`}
              >
                <img src={item.src} alt="" className="h-11 w-16 object-cover" />
              </button>
            ))}
          </div>
        )}

        <h1 className="mt-5 text-3xl font-semibold leading-tight">{vehicle.heading}</h1>
        {vehicle.description && <p className="mt-3 text-muted-foreground leading-relaxed">{vehicle.description}</p>}

        <div className="mt-6">
          <div className="text-sm font-medium">Weekly Rate</div>
          <div className="mt-1 text-4xl font-semibold">{vehicle.weeklyRateLabel}</div>
        </div>

        {vehicle.depositLabel && (
          <div className="mt-6">
            <div className="text-sm font-medium">Deposit</div>
            <div className="mt-1 text-lg">{vehicle.depositLabel}</div>
          </div>
        )}

        {vehicle.eligibility && (
          <div className="mt-6">
            <div className="text-sm font-medium">Rideshare Eligibility</div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {vehicle.eligibility.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6">
          <div className="text-sm font-medium">Requirements To Rent</div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {vehicle.requirements.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-real-red" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="sticky bottom-0 z-20 -mx-4 mt-8 border-t border-border bg-background p-4 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
          <Link
            to="/apply"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-real-red px-6 text-sm font-medium text-white"
          >
            Apply
          </Link>
        </div>
      </section>
    </SiteLayout>
  );
}
