// Server-only evidence issuer transport. One short-lived connection per issuer call,
// because a Workers socket cannot outlive the request that opened it.
// The login is rr_evidence_transport (provisioned separately, never an API role);
// every transaction narrows itself to rr_evidence_issuer before any statement runs.
import postgres from 'postgres';
import type { IssuerSql } from './record-rental-transport.server';

export const ISSUER_LOGIN = 'rr_evidence_transport';
export const ISSUER_ROLE = 'rr_evidence_issuer';

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// Refuses anything but the dedicated login, and plaintext to a non-local host.
export function parseIssuerUrl(raw: string) {
 let url: URL;
 try { url = new URL(raw); } catch { throw new Error('Record Rental issuer connection is not a valid URL'); }
 if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('Record Rental issuer connection must be postgres://');
 const user = decodeURIComponent(url.username);
 // Supavisor addresses a tenant as <role>.<project-ref>; the role part is what Postgres sees.
 if (user !== ISSUER_LOGIN && !user.startsWith(`${ISSUER_LOGIN}.`)) throw new Error('Record Rental issuer must connect as rr_evidence_transport');
 if (!url.password) throw new Error('Record Rental issuer connection has no password');
 const local = LOCAL.has(url.hostname);
 const sslmode = url.searchParams.get('sslmode');
 if (!local && sslmode !== 'require' && sslmode !== 'verify-full') throw new Error('Record Rental issuer connection must require TLS');
 return { url: url.toString(), ssl: local && (sslmode === null || sslmode === 'disable') ? false as const : 'require' as const };
}

export function issuerSql(raw: string, connect: typeof postgres = postgres): IssuerSql {
 const target = parseIssuerUrl(raw);
 return {
  async transaction(run) {
   // prepare:false keeps the transport valid behind a transaction-mode pooler.
   const sql = connect(target.url, { max: 1, prepare: false, ssl: target.ssl, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });
   try {
    return await sql.begin(async tx => {
     await tx.unsafe(`SET LOCAL ROLE ${ISSUER_ROLE}`);
     await tx.unsafe("SET LOCAL TIME ZONE 'UTC'");
     // The issuer statements cast every parameter in SQL ($1::jsonb, $2::uuid) and callers
     // pass JSON already serialized. Declaring strings as text (OID 25) stops the driver
     // from serializing that JSON a second time into a jsonb string scalar.
     const typed = (args: unknown[]) => args.map(a => typeof a === 'string' ? tx.typed(a, 25) : a);
     return run(async (statement, args) => [...await tx.unsafe(statement, typed(args) as any[])] as Array<Record<string, unknown>>);
    }) as any;
   } finally {
    await sql.end({ timeout: 5 });
   }
  },
 };
}
