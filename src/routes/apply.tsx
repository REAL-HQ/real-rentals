import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Nav } from "@/components/site/Nav";
import { FadeUp } from "@/components/site/FadeUp";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/apply")({
  validateSearch: (s: Record<string, unknown>) => ({ vehicle: (s.vehicle as string) || "" }),
  head: () => ({
    meta: [
      { title: "Step 1 of 2 — REAL AUTOMOTIVE" },
      { name: "description", content: "Get a rideshare vehicle quote in seconds. Step 1 of 2." },
      { property: "og:title", content: "Step 1 of 2 — REAL AUTOMOTIVE" },
      { property: "og:description", content: "Get a rideshare vehicle quote in seconds. Step 1 of 2." },
    ],
  }),
  component: ApplyStep1,
});

const STORAGE_KEY = "real-apply-step1-v1";

const PLATFORM_STATUSES = [
  { value: "Yes", label: "Yes" },
  { value: "Pending", label: "Pending" },
  { value: "Not Yet", label: "Not Yet" },
];

type Step1Form = {
  full_name: string;
  phone: string;
  email: string;
  platform_status: "Yes" | "Pending" | "Not Yet" | "";
  vehicle_id: string;
};

function getInitial(vehicle_id: string): Step1Form {
  return {
    full_name: "",
    phone: "",
    email: "",
    platform_status: "",
    vehicle_id,
  };
}

function ApplyStep1() {
  const { vehicle: preVehicle } = Route.useSearch();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [f, setF] = useState<Step1Form>(() => {
    if (typeof window === "undefined") return getInitial(preVehicle);
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...getInitial(preVehicle), ...JSON.parse(raw) } : getInitial(preVehicle);
  });

  const update = <K extends keyof Step1Form>(k: K, v: Step1Form[K]) => {
    setF((p) => {
      const next = { ...p, [k]: v };
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!z.string().min(2).safeParse(f.full_name).success) errs.full_name = "Required";
    if (!z.string().email().safeParse(f.email).success) errs.email = "Invalid email";
    if (!/^\d{7,}$/.test(f.phone.replace(/\D/g, ""))) errs.phone = "Invalid phone";
    if (!f.platform_status) errs.platform_status = "Required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  async function submit() {
    if (!validate()) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setSubmitting(true);
    const payload = {
      full_name: f.full_name,
      phone: f.phone,
      email: f.email,
      platform_status: f.platform_status,
      vehicle_id: f.vehicle_id || null,
      status: "pending",
    };
    const { data, error } = await supabase.from("applications").insert(payload).select("id").single();
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    navigate({ to: "/apply/step2", search: { id: data.id } });
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1">
        <section className="pt-12 md:pt-20 pb-24 mx-auto px-6 w-full max-w-[1600px]">
          <FadeUp>
            <div className="max-w-xl mx-auto">
              <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase mb-3">Step 1 Of 2</div>
              <h1 className="text-3xl md:text-4xl font-semibold">Get Your Quote</h1>
              <p className="mt-3 text-muted-foreground">Tell us a little about yourself to get started.</p>
            </div>
          </FadeUp>

          <FadeUp delay={80}>
            <div className="mt-10 max-w-xl mx-auto rounded-2xl bg-soft p-6 md:p-8">
              <div className="grid grid-cols-1 gap-5">
                <In label="Full name" v={f.full_name} e={errors.full_name} on={(v) => update("full_name", v)} />
                <In label="Email" type="email" v={f.email} e={errors.email} on={(v) => update("email", v)} />
                <In label="Phone" v={f.phone} e={errors.phone} on={(v) => update("phone", v)} />

                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Are You Already Active On A Gig App?</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PLATFORM_STATUSES.map((s) => {
                      const active = f.platform_status === s.value;
                      return (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => update("platform_status", s.value as Step1Form["platform_status"])}
                          className={`px-5 py-2 rounded-lg text-sm border transition ${
                            active
                              ? "bg-real-red text-white border-real-red"
                              : "bg-white text-foreground border-border hover:border-foreground/40"
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                  {errors.platform_status && <div className="mt-2 text-sm text-real-red">{errors.platform_status}</div>}
                </div>

              </div>

              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="mt-8 w-full inline-flex items-center justify-center rounded-lg bg-real-red text-white px-6 py-3 text-sm font-semibold hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Continue"}
              </button>
            </div>
          </FadeUp>
        </section>
      </main>
    </div>
  );
}

function In({
  label,
  type = "text",
  v,
  e,
  on,
}: {
  label: string;
  type?: string;
  v: string;
  e?: string;
  on: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(e) => on(e.target.value)}
        className={`mt-1 w-full bg-white border ${e ? "border-real-red" : "border-border"} rounded-lg px-3 py-2 text-sm`}
      />
      {e && <div className="mt-1 text-xs text-real-red">{e}</div>}
    </label>
  );
}
