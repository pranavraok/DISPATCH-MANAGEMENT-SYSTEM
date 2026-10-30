import { parse, type Row, type State } from "./domain";
import { shortReference } from "./codes";

export type WorkScope = { kind: "all" } | { kind: "packing" | "trip" | "shipment"; id: string };
export type WorkGroup = { key: string; title: string; detail: string; scope: WorkScope; rows: Row[] };
export const workKey = (scope: WorkScope) => scope.kind === "all" ? "all" : scope.kind + ":" + scope.id;
export function readWorkScope(search = window.location.search): WorkScope {
  const value = new URLSearchParams(search).get("work") ?? "all";
  const colon = value.indexOf(":");
  const kind = value.slice(0, colon);
  const id = value.slice(colon + 1);
  return ["packing", "trip", "shipment"].includes(kind) && id && id.length <= 100
    ? { kind: kind as "packing" | "trip" | "shipment", id }
    : { kind: "all" };
}
export function shipmentName(s: State, id: string) {
  const sh = s.shipments.find((x) => x.id === id);
  if (!sh) return "Shipment " + id;
  const customer = s.customers.find((x) => x.id === sh.customerId)?.name ?? sh.customerId;
  const trip = s.trips.find((x) => x.id === sh.tripId);
  return `${customer} · ${trip?.vehicle ?? shortReference(sh.tripId)} · ${sh.destination || "Destination not set"} · ${shortReference(sh.id)}`;
}
export function workTitle(s: State, scope: WorkScope) {
  if (scope.kind === "all") return "All work";
  if (scope.kind === "shipment") return shipmentName(s, scope.id);
  if (scope.kind === "trip") {
    const t = s.trips.find((x) => x.id === scope.id);
    return `Trip: ${t?.vehicle ?? scope.id} · ${scope.id}`;
  }
  const m = s.manifests.find((x) => x.id === scope.id);
  const customer = m?.customerId ? s.customers.find((x) => x.id === m.customerId)?.name ?? m.customerId : "General stock";
  return `Packing: ${m?.name ?? scope.id} · ${customer} · ${scope.id}`;
}

export function projectWork(s: State, scope: WorkScope): State {
  if (scope.kind === "all") return s;
  const cartonIds = new Set<string>();
  const shipmentIds = new Set<string>();
  const manifestIds = new Set<string>();
  const tripIds = new Set<string>();
  if (scope.kind === "packing") {
    manifestIds.add(scope.id);
    for (const c of s.cartons) if (c.manifestId === scope.id) cartonIds.add(c.id);
    for (const a of s.allocations) if (a.active && cartonIds.has(a.cartonId)) shipmentIds.add(a.shipmentId);
  } else {
    for (const sh of s.shipments) if (scope.kind === "trip" ? sh.tripId === scope.id : sh.id === scope.id) shipmentIds.add(sh.id);
    if (scope.kind === "trip") tripIds.add(scope.id);
    for (const a of s.allocations) if (a.active && shipmentIds.has(a.shipmentId)) cartonIds.add(a.cartonId);
    for (const c of s.cartons) if (cartonIds.has(c.id)) manifestIds.add(c.manifestId);
  }
  for (const sh of s.shipments) if (shipmentIds.has(sh.id)) tripIds.add(sh.tripId);
  const cartons = s.cartons.filter((c) => cartonIds.has(c.id));
  const labels = s.labels.filter((j) => parse<Row[]>(j.cartonSnapshots).some((c) => cartonIds.has(c.id)));
  const returns = s.returns.filter((r) => scope.kind === "packing" ? cartonIds.has(r.cartonId) : shipmentIds.has(r.shipmentId));
  const jobs = s.jobs.filter((j) => shipmentIds.has(j.shipmentId));
  const billings = s.billings.filter((b) => shipmentIds.has(b.shipmentId));
  const related = new Set([...cartonIds, ...manifestIds, ...tripIds, ...shipmentIds, ...labels.map((x) => x.id), ...returns.map((x) => x.id), ...jobs.map((x) => x.id), ...billings.map((x) => x.id)]);
  const mentions = (value: unknown): boolean => typeof value === "string" ? related.has(value) : Array.isArray(value) ? value.some(mentions) : !!value && typeof value === "object" && Object.values(value).some(mentions);
  const counts = new Map<string, number>();
  for (const c of cartons) counts.set(c.state, (counts.get(c.state) ?? 0) + 1);
  return {
    ...s,
    manifests: s.manifests.filter((m) => manifestIds.has(m.id)),
    cartons,
    cartonTotal: cartons.length,
    counts: [...counts].map(([state, count]) => ({ state, count })),
    shipments: s.shipments.filter((sh) => shipmentIds.has(sh.id)),
    trips: s.trips.filter((t) => tripIds.has(t.id)),
    allocations: s.allocations.filter((a) => shipmentIds.has(a.shipmentId)),
    loadingSessions: s.loadingSessions.filter((x) => shipmentIds.has(x.shipmentId)),
    labels, returns, jobs, billings,
    audit: s.audit.filter((a) => related.has(a.entityId) || mentions(parse(a.data))).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 80),
  };
}

export function groupWork(s: State, rows: Row[], type: "packing" | "carton" | "shipment" | "label" | "return" | "job" | "audit"): WorkGroup[] {
  const groups = new Map<string, WorkGroup>();
  const cartonShipments = new Map(s.allocations.filter((a) => a.active).map((a) => [a.cartonId, a.shipmentId]));
  const cartonsById = new Map(s.cartons.map((c) => [c.id, c]));
  function cartonScope(id: string): WorkScope | null {
    const shipmentId = cartonShipments.get(id);
    if (shipmentId) return { kind: "shipment", id: shipmentId };
    const c = cartonsById.get(id);
    return c ? { kind: "packing", id: c.manifestId } : null;
  }
  function scopeFor(row: Row): WorkScope | null {
    if (type === "packing") return { kind: "packing", id: row.id };
    if (type === "shipment") return { kind: "shipment", id: row.id };
    if (type === "carton") return cartonScope(row.id);
    if (type === "job" || type === "return") return { kind: "shipment", id: row.shipmentId };
    if (type === "label") {
      const scopes = parse<Row[]>(row.cartonSnapshots).map((c) => cartonScope(c.id));
      const keys = new Set(scopes.map((x) => x ? workKey(x) : "unknown"));
      return keys.size === 1 ? scopes[0] : null;
    }
    const eventData = parse<Row>(row.data ?? "{}");
    const explicitShipment = eventData?.input?.shipmentId ?? eventData?.shipmentId;
    if (explicitShipment) return { kind: "shipment", id: explicitShipment };
    if (s.shipments.some((x) => x.id === row.entityId)) return { kind: "shipment", id: row.entityId };
    if (s.trips.some((x) => x.id === row.entityId)) return { kind: "trip", id: row.entityId };
    if (s.manifests.some((x) => x.id === row.entityId)) return { kind: "packing", id: row.entityId };
    const carton = cartonScope(row.entityId);
    if (carton) return carton;
    const job = s.jobs.find((x) => x.id === row.entityId) ?? s.billings.find((x) => x.id === row.entityId) ?? s.returns.find((x) => x.id === row.entityId);
    if (job?.shipmentId) return { kind: "shipment", id: job.shipmentId };
    const resultId = eventData?.result?.id;
    if (resultId) {
      if (s.shipments.some((x) => x.id === resultId)) return { kind: "shipment", id: resultId };
      if (s.trips.some((x) => x.id === resultId)) return { kind: "trip", id: resultId };
      if (s.manifests.some((x) => x.id === resultId)) return { kind: "packing", id: resultId };
      const resultCarton = cartonScope(resultId);
      if (resultCarton) return resultCarton;
      const resultJob = s.jobs.find((x) => x.id === resultId) ?? s.billings.find((x) => x.id === resultId) ?? s.returns.find((x) => x.id === resultId);
      if (resultJob?.shipmentId) return { kind: "shipment", id: resultJob.shipmentId };
    }
    return null;
  }
  for (const row of rows) {
    const scope = scopeFor(row);
    const key = scope ? workKey(scope) : "other";
    if (!groups.has(key)) {
      const packingNames = scope?.kind === "shipment" ? [...new Set(s.allocations.filter((a) => a.active && a.shipmentId === scope.id).map((a) => cartonsById.get(a.cartonId)?.manifestId).filter(Boolean))].map((id) => s.manifests.find((m) => m.id === id)?.name ?? id) : [];
      groups.set(key, {
        key,
        scope: scope ?? { kind: "all" },
        title: scope ? workTitle(s, scope) : type === "label" ? "Shared print jobs" : "Other company activity",
        detail: scope?.kind === "packing" ? "Packing list · reserve cartons for a shipment after checking labels" : scope?.kind === "shipment" ? packingNames.length ? "Packing: " + packingNames.join(", ") : "Customer shipment" : scope?.kind === "trip" ? "Vehicle trip" : type === "label" ? "These print jobs contain cartons from more than one work group." : "No single packing list or shipment is linked to these records.",
        rows: [],
      });
    }
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()];
}
