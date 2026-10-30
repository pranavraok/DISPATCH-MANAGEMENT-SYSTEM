import { type ReactNode } from "react";
import { ArrowRight, Layers3 } from "lucide-react";
import type { Context } from "./main";
import { groupWork, shipmentName, workKey, workTitle, type WorkScope, type WorkGroup } from "./work";
import type { Row } from "./domain";
import { plainLabel } from "./brand";

export function WorkSelector({ ctx, companyWide = false }: { ctx: Context; companyWide?: boolean }) {
  const { all, work, selectWork } = ctx;
  return <section className="work-selector" aria-label="Current work">
    <Layers3 size={21} />
    <label><span>Show work</span><select aria-label="Show work" value={workKey(work)} onChange={(e) => {
      const value = e.target.value;
      const colon = value.indexOf(":");
      selectWork(value === "all" ? { kind: "all" } : { kind: value.slice(0, colon) as "packing" | "trip" | "shipment", id: value.slice(colon + 1) });
    }}>
      <option value="all">All packing lists and shipments</option>
      <optgroup label="Packing lists — before or after assignment">{all.manifests.map((m) => <option key={m.id} value={"packing:" + m.id}>{m.name} · {m.id}</option>)}</optgroup>
      {all.trips.map((t) => <optgroup key={t.id} label={t.vehicle + " · " + t.id + " · " + t.state}>
        <option value={"trip:" + t.id}>All customers on {t.vehicle} · {t.id}</option>
        {all.shipments.filter((sh) => sh.tripId === t.id).map((sh) => <option key={sh.id} value={"shipment:" + sh.id}>{shipmentName(all, sh.id)}</option>)}
      </optgroup>)}
      {all.shipments.some((sh) => !all.trips.some((t) => t.id === sh.tripId)) && <optgroup label="Other loaded shipments">{all.shipments.filter((sh) => !all.trips.some((t) => t.id === sh.tripId)).map((sh) => <option key={sh.id} value={"shipment:" + sh.id}>{shipmentName(all, sh.id)}</option>)}</optgroup>}
      {work.kind !== "all" && ![...all.manifests.map((m) => "packing:" + m.id), ...all.trips.map((t) => "trip:" + t.id), ...all.shipments.map((sh) => "shipment:" + sh.id)].includes(workKey(work)) && <option value={workKey(work)}>{workTitle(all, work)} — record not loaded</option>}
    </select></label>
    <div className="work-hint">{companyWide ? "Settings apply to the whole company." : work.kind === "all" ? "Records below are grouped by packing list or customer shipment." : "This selection stays with you across the sidebar and on refresh."}</div>
    {work.kind !== "all" && <button className="secondary small" onClick={() => selectWork({ kind: "all" })}>Show all work</button>}
  </section>;
}

export function GroupedRecords({ ctx, rows, type, children, focusable = true }: { ctx: Context; rows: Row[]; type: Parameters<typeof groupWork>[2]; children: (rows: Row[], group: WorkGroup) => ReactNode; focusable?: boolean }) {
  const groups = groupWork(ctx.all, rows, type);
  const noun = { packing: "packing list", carton: "carton", shipment: "shipment", label: "print job", return: "return", job: "invoice request", audit: "event" }[type];
  return <div className="work-groups">{groups.map((g) => <details className="record-group" key={g.key} open>
    <summary><span><strong>{g.title}</strong><small>{g.detail}</small></span><span className="record-count">{g.rows.length} {noun}{g.rows.length === 1 ? "" : "s"}</span></summary>
    {focusable && g.scope.kind !== "all" && workKey(g.scope) !== workKey(ctx.work) && <div className="group-actions"><button className="text-link" onClick={() => ctx.selectWork(g.scope)}>Show only this {g.scope.kind === "packing" ? "packing list" : g.scope.kind} <ArrowRight size={14} /></button></div>}
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
    <div className="panel-heading"><div><h2>Trips and customer shipments</h2><p>Choose a shipment to see its work across every section.</p></div></div>
    {s.trips.map((t) => <details className="record-group" key={t.id} open>
      <summary><span><strong>{t.vehicle} · {t.driver}</strong><small>{t.id} · {plainLabel(t.state)}</small></span><span className="record-count">{s.shipments.filter((sh) => sh.tripId === t.id).length} shipments</span></summary>
      {s.shipments.filter((sh) => sh.tripId === t.id).map((sh) => {
        const allocations = ctx.all.allocations.filter((a) => a.active && a.shipmentId === sh.id);
        return <div className="shipment-row" key={sh.id}><div><strong>{s.customers.find((c) => c.id === sh.customerId)?.name ?? sh.customerId}</strong><p>{sh.destination}</p><small>{sh.id} · {plainLabel(sh.state)}</small></div><div><strong>{allocations.filter((a) => a.state === "Loaded" || a.state === "Departed").length} / {allocations.length}</strong><small>cartons loaded</small></div><div className="button-row"><button className="secondary small" onClick={() => open({ kind: "shipment", id: sh.id }, "cartons")}>Labels</button><button className="secondary small" onClick={() => open({ kind: "shipment", id: sh.id }, "loading")}>Loading</button><button className="secondary small" onClick={() => open({ kind: "shipment", id: sh.id }, "billing")}>Billing</button></div></div>;
      })}
      {!s.shipments.some((sh) => sh.tripId === t.id) && <div className="group-actions"><p>No customer shipments on this trip yet.</p><button className="text-link" onClick={() => open({ kind: "trip", id: t.id }, "trips")}>Add customer & cartons <ArrowRight size={14} /></button></div>}
    </details>)}
  </section>;
}
