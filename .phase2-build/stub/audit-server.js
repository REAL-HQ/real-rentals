
export const logAudit = async (actor, entry) => { (globalThis.__fakeSb.audit ??= []).push({ actor: actor?.role ?? null, ...entry }); };
