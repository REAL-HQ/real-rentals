
      import { getApplicationDocGaps } from "./handler.mjs";
      const before = globalThis.__fakeSb?.reads ?? 0;
      let message = "";
      try { await getApplicationDocGaps({ context: { userId: "mgr-1" } }); }
      catch (error) { message = error instanceof Error ? error.message : String(error); }
      if (message !== "Application document gaps are disabled.") throw new Error(message || "no refusal");
      const reads = (globalThis.__fakeSb?.reads ?? 0) - before;
      if (reads !== 0) throw new Error("read " + reads + " tables");
    