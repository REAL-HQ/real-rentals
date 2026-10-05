// Browser side of the signed-PDF download. The bytes come from our own server
// (getAgreementPdf), so nothing navigates to a storage hostname that browser
// extensions or network filters may block.
export type AgreementPdfPayload = { base64: string; contentType: "application/pdf"; fileName: string };

export function saveAgreementPdf(p: AgreementPdfPayload) {
  const bin = atob(p.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: p.contentType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = p.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
