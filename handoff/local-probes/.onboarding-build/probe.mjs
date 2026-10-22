
      import { getOnboardingChecklist } from "./handler.mjs";
      const before = globalThis.__fakeSb?.reads ?? 0;
      let message = "";
      try { await getOnboardingChecklist({ context: { userId: "mgr-1" } }); }
      catch (error) { message = error instanceof Error ? error.message : String(error); }
      if (message !== "Onboarding checklist is disabled.") throw new Error(message || "no refusal");
      const reads = (globalThis.__fakeSb?.reads ?? 0) - before;
      if (reads !== 0) throw new Error("read " + reads + " tables");
    