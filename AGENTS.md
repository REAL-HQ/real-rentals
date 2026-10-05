- Marketing fleet category photos are bundled imports (src/assets/cars/{sedan,suv,minivan}.jpg), not CDN asset pointers — the dev asset proxy returned intermittent 502s for these.

- eSign: all signing/voiding/archiving goes through src/lib/esign.server.ts (atomic esign_claim/esign_void DB functions, PDF + SHA-256 archive with visible archive_status); rental agreements are a consumer — never add a parallel signing path.
- eSign delivery: email/SMS outcomes are recorded per channel on the agreement (sent/failed/not_attempted) via deliverSigningLink and never change document status; Retry Delivery = Resend and always rotates the token, because only the token hash is stored.
- eSign PDF access: completed PDFs reach browsers only as bytes from getAgreementPdf (caller RLS decides access, server downloads from the private bucket), saved via saveAgreementPdf; never hand out storage signed URLs, because browser filters block the storage host and paths leak.
