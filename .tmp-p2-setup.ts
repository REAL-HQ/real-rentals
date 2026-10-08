import { supabaseAdmin as A } from "@/integrations/supabase/client.server";
const T = "zz-p2";
const mk = async (email: string, extra: any = {}) => {
  const { data, error } = await A.auth.admin.createUser({ email, email_confirm: true, ...extra });
  if (error) throw error;
  return data.user!.id;
};
const app = async (email: string, extra: any = {}) => {
  const { data, error } = await A.from("applications").insert({ full_name: `Zz P2 ${T}`, email, phone: "(813) 555-0199", source: T, ...extra } as any).select("id").single();
  if (error) throw error;
  return data.id;
};
const out: any = {};
out.wl = (await A.from("waitlist").insert({ full_name: "Zz P2 Waitlist", email: "team+p2wl@drivereal.com", phone: "(813) 555-0198", source: T, city: "Tampa", state: "FL" } as any).select("id").single()).data?.id;
out.app = await app("team+p2app@drivereal.com", { status: "new", current_step: "documents" });
out.dup1 = await app("team+p2dup@drivereal.com");
out.dup2 = await app("team+p2dup@drivereal.com");
out.otherUser = await mk("team+p2other@drivereal.com");
out.owned = await app("team+p2own@drivereal.com", { user_id: out.otherUser });
out.staff = await mk("team+p2staff@drivereal.com");
await A.from("user_roles").insert({ user_id: out.staff, role: "team" } as any);
out.drv = await mk("team+p2drv@drivereal.com", { password: "Zz-P2-test-Passw0rd!" });
await A.from("user_roles").insert({ user_id: out.drv, role: "driver" } as any);
out.drvApp = await app("team+p2drv@drivereal.com", { status: "approved", user_id: out.drv, current_step: "profile_complete" });
await Bun.write("/tmp/browser/p2/fx.json", JSON.stringify(out, null, 1));
console.log(out);
