import { useId, type ReactNode } from "react";
import { ArrowRight, Layers3 } from "lucide-react";
import type { Context } from "./main";
import { groupWork, shipmentName, workKey, workTitle, type WorkScope, type WorkGroup } from "./work";
import type { Row } from "./domain";
import { plainLabel } from "./brand";

export function WorkSelector({ ctx, companyWide = false }: { ctx: Context; companyWide?: boolean }) {
  const { all, work, selectWork } = ctx;
  if (companyWide) return null;
  return <section className="work-selector" aria-label="Current work">
    <Layers3 size={18} aria-hidden="true" />
    <label><span>Show work</span><select aria-label="Show work" value={workKey(work)} onChange={(e) => {
      const value = e.target.value;
      const colon = value.indexOf(":");
      selectWork(value === "all" ? { kind: "all" } : { kind: value.slice(0, colon) as "packing" | "trip" | "shipment", id: value.slice(colon + 1) });
    }}>
      <option value="all">All work</option>
      <optgroup label="Packing lists — before or after assignment">{all.manifests.map((m) => <option key={m.id} value={"packing:" + m.id}>{m.name} · {m.id}</option>)}</optgroup>
      {all.trips.map((t) => <optgroup key={t.id} label={t.vehicle + " · " + t.id + " · " + t.state}>
        <option value={"trip:" + t.id}>All customers on {t.vehicle} · {t.id}</option>
        {all.shipments.filter((sh) => sh.tripId === t.id).map((sh) => <option key={sh.id} value={"shipment:" + sh.id}>{shipmentName(all, sh.id)}</option>)}
      </optgroup>)}
      {all.shipments.some((sh) => !all.trips.some((t) => t.id === sh.tripId)) && <optgroup label="Other loaded shipments">{all.shipments.filter((sh) => !all.trips.some((t) => t.id === sh.tripId)).map((sh) => <option key={sh.id} value={"shipment:" + sh.id}>{shipmentName(all, sh.id)}</option>)}</optgroup>}
      {work.kind !== "all" && ![...all.manifests.map((m) => "packing:" + m.id), ...all.trips.map((t) => "trip:" + t.id), ...all.shipments.map((sh) => "shipment:" + sh.id)].includes(workKey(work)) && <option value={workKey(work)}>{workTitle(all, work)} — record not loaded</option>}
    </select></label>
    {work.kind !== "all" && <button className="secondary small" onClick={() => selectWork({ kind: "all" })}>Show all work</button>}
  </section>;
}

export function GroupedRecords({ ctx, rows, type, children, focusable = true, expand = false }: { ctx: Context; rows: Row[]; type: Parameters<typeof groupWork>[2]; children: (rows: Row[], group: WorkGroup) => ReactNode; focusable?: boolean; expand?: boolean }) {
  const accordionId = useId();
  const groups = groupWork(ctx.all, rows, type);
  const noun = { packing: "packing list", carton: "carton", shipment: "shipment", label: "print job", return: "return", job: "invoice request", audit: "event" }[type];
  return <div className="work-groups">{groups.map((g) => <details className="record-group" key={g.key} name={expand ? undefined : accordionId} open={expand || groups.length === 1}>
    <summary><span><strong>{g.title}</strong></span><span className="record-count">{g.rows.length} {noun}{g.rows.length === 1 ? "" : "s"}</span></summary>
    <div className="group-actions"><p>{g.detail}</p>{focusable && g.scope.kind !== "all" && workKey(g.scope) !== workKey(ctx.work) && <button className="text-link" onClick={() => ctx.selectWork(g.scope)}>Show only this {g.scope.kind === "packing" ? "packing list" : g.scope.kind} <ArrowRight size={14} /></button>}</div>
    {children(g.rows, g)}
  </details>)}</div>;
}

export function ShipmentChoices({ ctx, shipments }: { ctx: Context; shipments: Row[] }) {
  const tripIds = [...new Set(shipments.map((sh) => sh.tripId))];
  return <>{tripIds.map((id) => <optgroup key={id} label={(ctx.all.trips.find((t) => t.id === id)?.vehicle ?? id) + " · " + id}>
    {shipments.filter((sh) => sh.tripId === id).map((sh) => <option value={sh.id} key={sh.id}>{shipmentName(ctx.all, sh.id)}</option>)}
  </optgroup>)}</>;
}

export function ShipmentOverview({ ctx }: { ctx: Context }) {
  const { s } = ctx;
  if (!s.trips.length) return null;
  function open(scope: WorkScope, page: string) { if (ctx.selectWork(scope)) ctx.navigate(page); }
  return <section className="panel shipment-overview">
    <div className="panel-heading"><div><h2>Trips and customer shipments</h2><p>Open a trip to choose a customer shipment.</p></div></div>
    {s.trips.map((t) => <details className="record-group" key={t.id} name="home-trips" open={s.trips.length === 1}>
      <summary><span><strong>{t.vehicle} · {t.driver}</strong><small>{t.id} · {plainLabel(t.state)}</small></span><span className="record-count">{s.shipments.filter((sh) => sh.tripId === t.id).length} shipments</span></summary>
      {s.shipments.filter((sh) => sh.tripId === t.id).map((sh) => {
        const allocations = ctx.all.allocations.filter((a) => a.active && a.shipmentId === sh.id);
        const target = sh.state === "Cancelled" || sh.state === "Departed" ? "trips" : sh.loadApproved ? "billing" : "loading";
        return <div className="shipment-row" key={sh.id}><div><strong>{s.customers.find((c) => c.id === sh.customerId)?.name ?? sh.customerId}</strong><p>{sh.destination}</p><small>{sh.id} · {plainLabel(sh.state)}</small></div><div><strong>{allocations.filter((a) => a.state === "Loaded" || a.state === "Departed").length} / {allocations.length}</strong><small>cartons loaded</small></div><button className="secondary small" aria-label={"Open shipment " + sh.id} onClick={() => open({ kind: "shipment", id: sh.id }, target)}>Open shipment <ArrowRight size={14} /></button></div>;
      })}
      {!s.shipments.some((sh) => sh.tripId === t.id) && <div className="group-actions"><p>No customer shipments on this trip yet.</p><button className="text-link" onClick={() => open({ kind: "trip", id: t.id }, "trips")}>Add customer & cartons <ArrowRight size={14} /></button></div>}
    </details>)}
  </section>;
}
