/**
 * Warning the driver can override. It does not upload and it does not block
 * a file that already passed type and size.
 */
export function UploadPrecheckNotice({
  warnings,
  tips,
  onUpload,
  onRetake,
}: {
  warnings: { code: string; message: string }[];
  tips: string[];
  onUpload: () => void;
  onRetake: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-[#F6E7B8] bg-[#FFF8E5] p-4">
      <h3 className="text-sm font-semibold text-[#8A6A00]">Photo Quality</h3>
      <ul className="mt-2 space-y-1">
        {warnings.map((warning) => (
          <li key={warning.code} className="text-[13px] text-[#8A6A00]">
            {warning.message}
          </li>
        ))}
      </ul>
      {tips.map((tip) => (
        <p key={tip} className="mt-2 text-[13px] text-[#8A6A00]">
          {tip}
        </p>
      ))}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onUpload}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#111114] px-4 text-sm font-semibold text-white"
        >
          Upload Anyway
        </button>
        <button
          type="button"
          onClick={onRetake}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#E4D7A2] bg-white px-4 text-sm font-semibold text-[#8A6A00]"
        >
          Choose Another
        </button>
      </div>
    </div>
  );
}
