import { useId, type ReactNode } from "react";
import { ArrowRight, ChevronRight, Layers3 } from "lucide-react";
import type { Context } from "./main";
import { groupWork, shipmentName, workKey, workTitle, type WorkScope, type WorkGroup } from "./work";
import { parse, number, type Row, type Group, type Line, type State } from "./domain";
import { shortReference } from "./codes";
import { plainLabel } from "./brand";

export function WorkCardSummary({ state, scope, fallbackTitle = "Other work", countText, heading = false, cartons }: { state: State; scope: WorkScope; fallbackTitle?: string; countText?: string; heading?: boolean; cartons?: Row[] }) {
  let kind = "Work group", title = fallbackTitle, subtitle = "", status = "";
  let facts: [string, string][] = [];
  if (scope.kind === "packing") {
    const m = state.manifests.find((row) => row.id === scope.id);
    const groups = parse<Group[]>(m?.groups ?? "[]");
    kind = "Packing list"; title = m?.name ?? "Packing list"; status = m?.state ?? "";
    subtitle = m?.customerId ? state.customers.find((c) => c.id === m.customerId)?.name ?? "Customer not loaded" : "General stock";
    const lines = cartons ? cartons.flatMap((c) => parse<Line[]>(c.lines)) : groups.flatMap((g) => g.lines);
    facts = [[cartons ? "Boxes shown" : "Boxes", number(cartons?.length ?? groups.reduce((n, g) => n + g.count, 0))], ["Item types", number(new Set(lines.map((line) => line.sku)).size)]];
  } else if (scope.kind === "shipment") {
    const sh = state.shipments.find((row) => row.id === scope.id);
    const allocations = state.allocations.filter((a) => a.active && a.shipmentId === scope.id);
    kind = "Shipment"; title = state.customers.find((c) => c.id === sh?.customerId)?.name ?? "Customer shipment";
    subtitle = sh?.destination || "Destination not set";
    const invoice = state.jobs.find((job) => job.shipmentId === scope.id && job.state === "Confirmed");
    status = sh?.state === "Departed" ? "Completed" : invoice ? "InvoiceCompleted" : sh?.state ?? "";
    facts = [[cartons ? "Boxes shown" : "Boxes", number(cartons?.length ?? allocations.length)], ["Loaded", number(cartons ? cartons.filter((c) => ["Loaded", "Departed"].includes(c.state)).length : allocations.filter((a) => ["Loaded", "Departed"].includes(a.state)).length)]];
  } else if (scope.kind === "trip") {
    const trip = state.trips.find((row) => row.id === scope.id);
    const shipments = state.shipments.filter((sh) => sh.tripId === scope.id);
    const ids = new Set(shipments.map((sh) => sh.id));
    kind = "Vehicle trip"; title = trip?.vehicle ?? "Vehicle trip"; subtitle = trip?.driver || "Driver not set"; status = trip?.state ?? "";
    facts = [["Shipments", number(shipments.length)], ["Boxes", number(state.allocations.filter((a) => a.active && ids.has(a.shipmentId)).length)]];
  }
  const tone = ["Approved", "Open", "LoadApproved", "Departed", "Completed", "InvoiceCompleted"].includes(status) ? "sage" : status ? "amber" : "neutral";
  return <>
    <div className="work-card-top"><span className="work-card-kind">{kind}</span>{status && <span className={"badge " + tone}>{plainLabel(status)}</span>}</div>
    {heading ? <h2 className="work-card-title">{title}</h2> : <strong className="work-card-title">{title}</strong>}
    {subtitle && <p className="work-card-subtitle">{subtitle}</p>}
    {scope.kind !== "all" && <span className="work-card-reference" title={scope.id}>{shortReference(scope.id)}</span>}
    {facts.length > 0 && <div className="work-card-facts">{facts.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
    <div className="work-card-footer"><span>{countText || "View trip"}</span><ChevronRight size={17} className="card-open-icon" aria-hidden="true" /></div>
  </>;
}

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
      <optgroup label="Packing lists - before or after assignment">{all.manifests.map((m) => <option key={m.id} value={"packing:" + m.id}>{m.name} · {shortReference(m.id)}</option>)}</optgroup>
      {all.trips.map((t) => <optgroup key={t.id} label={t.vehicle + " · " + shortReference(t.id) + " · " + t.state}>
        <option value={"trip:" + t.id}>All customers on {t.vehicle} · {shortReference(t.id)}</option>
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
  const noun = { packing: "packing list", carton: "box", shipment: "shipment", label: "print job", return: "return", job: "invoice request", audit: "event" }[type];
  return <div className="work-groups record-card-grid">{groups.map((g) => <details className="record-group work-card" key={g.key} name={expand ? undefined : accordionId} open={expand || groups.length === 1}>
    <summary><WorkCardSummary state={ctx.all} scope={g.scope} fallbackTitle={g.title} cartons={type === "carton" ? g.rows : undefined} countText={g.rows.length + " " + noun + (g.rows.length === 1 ? "" : "s") + " · View details"} /></summary>
    <div className="group-actions"><p>{g.detail}</p>{focusable && g.scope.kind !== "all" && workKey(g.scope) !== workKey(ctx.work) && <button className="text-link" onClick={() => ctx.selectWork(g.scope)}>Show only this {g.scope.kind === "packing" ? "packing list" : g.scope.kind} <ArrowRight size={14} /></button>}</div>
    <div className="group-records">{children(g.rows, g)}</div>
  </details>)}</div>;
}

export function ShipmentChoices({ ctx, shipments }: { ctx: Context; shipments: Row[] }) {
  const tripIds = [...new Set(shipments.map((sh) => sh.tripId))];
  return <>{tripIds.map((id) => <optgroup key={id} label={(ctx.all.trips.find((t) => t.id === id)?.vehicle ?? shortReference(id)) + " · " + shortReference(id)}>
    {shipments.filter((sh) => sh.tripId === id).map((sh) => <option value={sh.id} key={sh.id}>{shipmentName(ctx.all, sh.id)}</option>)}
  </optgroup>)}</>;
}

export function ShipmentOverview({ ctx }: { ctx: Context }) {
  const { s } = ctx;
  if (!s.trips.length) return null;
  function open(scope: WorkScope, page: string) { if (ctx.selectWork(scope)) ctx.navigate(page); }
  return <section className="panel shipment-overview">
    <div className="panel-heading"><div><h2>Trips and customer shipments</h2><p>Open a trip to choose a customer shipment.</p></div></div>
    <div className="record-card-grid">{s.trips.map((t) => <details className="record-group work-card" key={t.id} name="home-trips" open={s.trips.length === 1}>
      <summary><WorkCardSummary state={ctx.all} scope={{ kind: "trip", id: t.id }} /></summary>
      <div className="shipment-card-grid">{s.shipments.filter((sh) => sh.tripId === t.id).map((sh) => {
        const allocations = ctx.all.allocations.filter((a) => a.active && a.shipmentId === sh.id);
        const target = sh.state === "Cancelled" || sh.state === "Departed" ? "trips" : sh.loadApproved ? "billing" : "loading";
        const hasConfirmedInvoice = ctx.all.jobs.some((job) => job.shipmentId === sh.id && job.state === "Confirmed");
        const displayStatus = sh.state === "Departed" ? "Completed" : hasConfirmedInvoice ? "InvoiceCompleted" : sh.state;
        return <div className="shipment-card" key={sh.id}><div><strong>{s.customers.find((c) => c.id === sh.customerId)?.name ?? sh.customerId}</strong><p>{sh.destination}</p><small title={sh.id}>{shortReference(sh.id)} · {plainLabel(displayStatus)}</small></div><div><strong>{allocations.filter((a) => a.state === "Loaded" || a.state === "Departed").length} / {allocations.length}</strong><small>boxes loaded</small></div><button className="secondary" aria-label={"Open shipment " + sh.id} onClick={() => open({ kind: "shipment", id: sh.id }, target)}>Open shipment <ArrowRight size={14} /></button></div>;
      })}</div>
      {!s.shipments.some((sh) => sh.tripId === t.id) && <div className="group-actions"><p>No customer shipments on this trip yet.</p><button className="text-link" onClick={() => open({ kind: "trip", id: t.id }, "trips")}>Add customer & boxes <ArrowRight size={14} /></button></div>}
    </details>)}</div>
  </section>;
}
