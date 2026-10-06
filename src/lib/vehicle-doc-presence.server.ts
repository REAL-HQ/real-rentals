// Server loader for canonical vehicle-document presence. Callers must have
// already verified the actor is staff; pass includeFinance only for Manager+.
import { vehicleDocPresence, isFinanceKind, type PresenceDoc, type Presence } from "@/lib/vehicle-doc-presence";

export async function loadVehicleDocPresence(
  sb: any,
  vehicleId: string,
  includeFinance: boolean,
): Promise<Presence & { kinds: string[]; direct: PresenceDoc[]; linked: PresenceDoc[] }> {
  const [{ data: own }, { data: links }] = await Promise.all([
    sb.from("documents").select("id,kind,file_name,expires_at,created_at").eq("vehicle_id", vehicleId).eq("is_current", true).is("driver_id", null),
    sb.from("document_vehicle_links").select("document_id").eq("vehicle_id", vehicleId),
  ]);
  const ids = (links ?? []).map((l: any) => l.document_id);
  let linked: PresenceDoc[] = [];
  if (ids.length) {
    const [{ data: docs }, { data: all }] = await Promise.all([
      sb.from("documents").select("id,kind,file_name,expires_at,created_at").in("id", ids).eq("is_current", true).is("driver_id", null),
      sb.from("document_vehicle_links").select("document_id").in("document_id", ids),
    ]);
    const count: Record<string, number> = {};
    for (const l of all ?? []) count[l.document_id] = (count[l.document_id] ?? 0) + 1;
    linked = (docs ?? []).map((d: any) => ({ ...d, relatedVehicles: count[d.id] ?? 1 }));
  }
  const keep = (d: PresenceDoc) => includeFinance || !isFinanceKind(d.kind);
  const direct = ((own ?? []) as PresenceDoc[]).filter(keep);
  linked = linked.filter(keep);
  const p = vehicleDocPresence(direct, linked);
  const kinds = [...new Set([...direct, ...linked].map((d) => String(d.kind ?? "")))];
  return { ...p, kinds, direct, linked };
}
