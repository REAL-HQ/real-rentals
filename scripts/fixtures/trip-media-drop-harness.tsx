// Browser harness for scripts/trip-media-drop.e2e.mjs. Renders the real
// FileUploader + FileDropBridge exactly as the trip panels configure them.
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { FileUploader } from "@/components/FileUploader";
import { FileDropBridge } from "@/components/FileDropBridge";
import { TRIP_MEDIA_ACCEPT, TRIP_MEDIA_MAX_BYTES } from "@/lib/trip-media";

declare global {
  interface Window {
    calls: Array<{ phase: string; name: string; size: number; type: string; head: number[] }>;
    toasts: string[];
  }
}
window.calls = [];

function zone(phase: string) {
  return (
    <div data-phase={phase}>
      <FileUploader
        variant="zone"
        title={`Drop ${phase}`}
        label="Choose Files"
        accept={TRIP_MEDIA_ACCEPT}
        maxBytes={TRIP_MEDIA_MAX_BYTES}
        multiple
        upload={async (file, { onProgress }) => {
          const head = [...new Uint8Array(await file.slice(0, 4).arrayBuffer())];
          window.calls.push({ phase, name: file.name, size: file.size, type: file.type, head });
          onProgress(50);
          if (file.name.startsWith("fail")) throw new Error("Network dropped");
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <Toaster />
    <FileDropBridge />
    {zone("checkout")}
    {zone("checkin")}
  </>,
);
