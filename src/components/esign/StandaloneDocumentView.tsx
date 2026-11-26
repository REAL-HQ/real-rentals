import { useEffect, useState } from "react";
import { PdfFieldPages } from "@/components/esign/PdfFieldPages";
import { FIELD_LABEL, type SourcePdfClient } from "@/lib/standalone-doc";

/** The renter's view of the uploaded PDF, with the boxes staff placed. */
export function StandaloneDocumentView({ source }: { source: SourcePdfClient }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(source.url);
        if (!res.ok) throw new Error("The document could not be loaded");
        const buf = new Uint8Array(await res.arrayBuffer());
        if (!cancelled) setBytes(buf);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "The document could not be loaded");
      }
    })();
    return () => { cancelled = true; };
  }, [source.url]);

  return (
    <div className="mt-5 rounded-xl border border-[#EDEDF0] bg-white p-3 sm:p-4">
      <p className="px-1 pb-3 text-[13px] text-[#55555E]">
        {source.fallback
          ? "Your signature will be added on a page at the end of this document. The original file is kept unchanged."
          : "Highlighted boxes show where your signature, printed name and date will appear."}
      </p>
      {!source.fallback && source.fields.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-2 px-1">
          {source.fields.map((f, i) => (
            <li key={i} className="rounded-md border border-[#E6E6EA] bg-[#FAFAFB] px-2 py-1 text-[12px] font-semibold text-[#28282E]">
              {FIELD_LABEL[f.type]} · Page {f.page}
            </li>
          ))}
        </ul>
      ) : null}
      {err ? <p className="p-3 text-[13px] text-[#8A1F12]">{err} Ask the team to resend the link.</p> : null}
      <PdfFieldPages bytes={bytes} fields={source.fallback ? [] : source.fields} />
    </div>
  );
}
