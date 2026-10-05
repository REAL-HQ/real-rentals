- Marketing fleet category photos are bundled imports (src/assets/cars/{sedan,suv,minivan}.jpg), not CDN asset pointers — the dev asset proxy returned intermittent 502s for these.

- eSign: all signing/voiding/archiving goes through src/lib/esign.server.ts (atomic esign_claim/esign_void DB functions, PDF + SHA-256 archive with visible archive_status); rental agreements are a consumer — never add a parallel signing path.
