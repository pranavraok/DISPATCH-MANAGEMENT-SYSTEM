import { useEffect, useState, type FormEvent } from "react";
import { Badge, Field, type Context } from "./main";
import { api } from "./api";
import { date, money, number, parse, type Line, type Row } from "./domain";
import { labelPdf } from "./labels";
import { DispatchScanScreen, hasPendingScan } from "./scanner";

const may = (ctx: Context, ...roles: string[]) => !ctx.sample && ctx.user.roles.some((r: string) => r === "Admin" || roles.includes(r));
const quantity = (value: number | string) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 }).format(Number(value));
const content = (ctx: Context, carton: Row) => parse<Line[]>(carton.lines).map(l => `${ctx.all.products.find(p => p.sku === l.sku)?.name ?? l.sku}: ${quantity(l.quantity)} ${l.unit}`).join(" + ");

function ProductInventory({ ctx }: { ctx: Context }) {
  const inventory = ctx.all.packedInventory;
  return <section className="panel panel-padding">
    <h2>Products available in packed inventory</h2>
    <p>Totals cover all available cartons. Carton plans without generated QR labels, held cartons and cartons scanned for dispatch are excluded.</p>
    {inventory?.products.length ? <div className="table-wrap"><table>
      <thead><tr><th>Product</th><th>Available quantity</th><th>Cartons containing product</th></tr></thead>
      <tbody>{inventory.products.map(p => <tr key={p.sku + "|" + p.unit}><td><strong>{ctx.all.products.find(item => item.sku === p.sku)?.name ?? p.sku}</strong><small>{p.sku}</small></td><td>{quantity(p.quantity)} {p.unit}</td><td>{number(p.cartons)}</td></tr>)}</tbody>
    </table></div> : <p>No available packed products yet. Generate carton QR labels to add stock.</p>}
    <small>A mixed carton contributes to each product row. The total number of physical cartons is shown separately above.</small>
  </section>;
}

export function AromazenHome(ctx: Context) {
  const inventory = ctx.all.packedInventory;
  return <>
    <div className="page-heading"><div><span className="eyebrow">AROMAZEN PVT LTD</span><h1>Packed stock & dispatch</h1><p>Record carton contents, generate QR labels into inventory, then scan cartons for a customer when dispatching.</p></div><button className="primary" onClick={() => ctx.navigate("packing")}>Add packed cartons</button></div>
    <div className="home-totals">
      <div><strong>{number(inventory?.availableCartons ?? 0)}</strong><span>Available cartons</span></div>
      <div><strong>{number(inventory?.products.length ?? 0)}</strong><span>Products in stock</span></div>
      <div><strong>{number(inventory?.pendingLabels ?? 0)}</strong><span>Cartons awaiting QR</span></div>
      <div><strong>{number(inventory?.loadedCartons ?? 0)}</strong><span>Scanned for dispatch</span></div>
    </div>
    <nav className="task-flow" aria-label="AROMAZEN workflow">{[["Carton contents & QR", "packing"], ["Packed inventory", "cartons"], ["Customer & dispatch scan", "trips"], ["Bill & Tally invoice", "billing"]].map(([label, page], i) => <button key={page} onClick={() => ctx.navigate(page)}><span>{i + 1}</span>{label}</button>)}</nav>
    <ProductInventory ctx={ctx} />
    <section className="panel panel-padding"><h2>Scan only when dispatching</h2><p>Generating a carton's QR label adds that carton and its recorded products to inventory immediately. Print and attach the label. When an order arrives, select the customer and scan the whole carton into that customer's bill.</p><p>Reprinting keeps the same carton identity and quantities. Use Inventory's contents lookup to inspect a QR without moving stock.</p></section>
  </>;
}

type ProductDraft = { sku: string; quantity: string };
type CartonDraft = { marking: string; count: string; lines: ProductDraft[] };
const newGroup = (index = 0): CartonDraft => ({ marking: String.fromCharCode(65 + index), count: "1", lines: [{ sku: "", quantity: "20" }] });

export function AromazenPacking(ctx: Context) {
  const [name, setName] = useState(""), [groups, setGroups] = useState<CartonDraft[]>([newGroup()]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState<Row | null>(null), [generated, setGenerated] = useState(false);
  const products = ctx.all.products.filter(p => p.inTally !== false);
  const totalCartons = groups.reduce((n, g) => n + (Number(g.count) || 0), 0);
  function updateGroup(index: number, changes: Partial<CartonDraft>) { setGroups(prev => prev.map((g, i) => i === index ? { ...g, ...changes } : g)); }
  function updateLine(groupIndex: number, lineIndex: number, changes: Partial<ProductDraft>) {
    setGroups(prev => prev.map((g, i) => i === groupIndex ? { ...g, lines: g.lines.map((l, j) => j === lineIndex ? { ...l, ...changes } : l) } : g));
  }
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const result = await ctx.run("registerStockCartons", {
        name, warehouseId: ctx.all.warehouses[0]?.id, customerId: null, notes: "",
        groups: groups.map(g => ({ marking: g.marking, count: Number(g.count), lines: g.lines.map(l => ({ ...l, unit: products.find(p => p.sku === l.sku)?.unit })) })),
      });
      setSaved(result); setGenerated(false); setName(""); setGroups([newGroup()]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function generate() {
    if (!saved || busy) return; setBusy(true); setError("");
    let inventorySaved = false;
    try {
      const result = await ctx.run("createLabels", { ids: saved.cartons.map((c: Row) => c.id), reason: generated ? "Reprint existing AROMAZEN QR labels" : "Generate carton QR labels and packed inventory" });
      inventorySaved = true; setGenerated(true); setSaved({ ...saved, cartons: result.cartons });
      await labelPdf(result.cartons, ctx.all.company.name);
    } catch (e) { setError((inventorySaved ? "Your QR labels and inventory are saved. Print the same labels again if the PDF did not open. " : "") + (e as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow">STEP 1 · CARTON CONTENTS & QR</span><h1>Record packed cartons</h1><p>Start with one product. Add more products to the same carton, or another carton group for a different mix.</p></div></div>
    {saved && <section className="panel panel-padding" aria-label="Saved carton plan">
      <h2>{saved.cartons.length} cartons {generated ? "added to inventory" : "ready for QR labels"}</h2>
      <p>{generated ? "These carton and product quantities are now in packed inventory. Attach each printed QR to its matching carton. There is no receiving scan or approval step." : "The contents are saved. Generate the QR labels below to add these cartons and their products to available inventory."}</p>
      <div className="button-row"><button className="primary" disabled={busy || !may(ctx, "PackingClerk", "PackingSupervisor")} onClick={() => void generate()}>{busy ? "Preparing…" : generated ? "Print the same QR labels again" : "Generate QR & add to inventory"}</button><button className="secondary" onClick={() => { ctx.selectWork({ kind: "all" }); ctx.navigate("cartons"); }}>View inventory</button></div>
    </section>}
    <form className="panel panel-padding" onSubmit={save}>
      <Field label="Packing batch name"><input required minLength={3} maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="For example, today's finished bottles" /></Field>
      {groups.map((group, gi) => <section className="group-editor" key={gi}>
        <h2>Carton group {gi + 1}</h2>
        <div className="form-grid"><Field label={`Group ${gi + 1} marking`}><input required maxLength={80} value={group.marking} onChange={e => updateGroup(gi, { marking: e.target.value })} /></Field><Field label={`Group ${gi + 1} identical cartons`}><input required type="number" min={1} max={1000} step={1} value={group.count} onChange={e => updateGroup(gi, { count: e.target.value })} /></Field></div>
        <p>Every carton in this group contains all the quantities below.</p>
        {group.lines.map((line, li) => <div className="form-grid" key={li}>
          <Field label={`Group ${gi + 1} product ${li + 1}`}><select required value={line.sku} onChange={e => updateLine(gi, li, { sku: e.target.value })}><option value="">Choose product</option>{products.filter(p => p.sku === line.sku || !group.lines.some(l => l.sku === p.sku)).map(p => <option value={p.sku} key={p.id}>{p.name} · {p.sku}</option>)}</select></Field>
          <Field label={`Group ${gi + 1} product ${li + 1} quantity per carton (${products.find(p => p.sku === line.sku)?.unit ?? "bottles"})`}><input required type="number" min="0.000001" max="100000000" step="0.000001" value={line.quantity} onChange={e => updateLine(gi, li, { quantity: e.target.value })} /></Field>
          {group.lines.length > 1 && <button type="button" className="text-link" aria-label={`Remove group ${gi + 1} product ${li + 1}`} onClick={() => updateGroup(gi, { lines: group.lines.filter((_, i) => i !== li) })}>Remove product</button>}
        </div>)}
        <div className="button-row"><button type="button" className="secondary small" disabled={group.lines.length >= 100} onClick={() => updateGroup(gi, { lines: [...group.lines, { sku: "", quantity: "1" }] })}>Add another product to these cartons</button>{groups.length > 1 && <button type="button" className="text-link" onClick={() => setGroups(prev => prev.filter((_, i) => i !== gi))}>Remove carton group {gi + 1}</button>}</div>
      </section>)}
      <div className="button-row"><button type="button" className="secondary" onClick={() => setGroups(prev => [...prev, newGroup(prev.length)])}>Add another carton group</button><strong>{number(totalCartons)} cartons in this plan</strong><button className="primary" disabled={busy || !products.length || totalCartons < 1 || totalCartons > 1000 || !may(ctx, "PackingClerk", "PackingSupervisor")}>{busy ? "Saving…" : "Save carton contents"}</button></div>
      {totalCartons > 1000 && <p className="notice amber">Create at most 1,000 cartons per label batch. Split larger packing runs into separate batches.</p>}
      {!products.length && <p>Add AROMAZEN products in Settings before recording cartons.</p>}
    </form>
    {error && <div className="notice error" role="alert">{error}</div>}
    <section className="panel panel-padding"><h2>Recorded packing batches</h2>{ctx.all.manifests.map(m => <p key={m.id}><strong>{m.name}</strong> · {date(m.createdAt)} <button className="text-link" onClick={() => { if (ctx.selectWork({ kind: "packing", id: m.id })) ctx.navigate("cartons"); }}>View cartons & labels</button></p>)}</section>
  </>;
}

export function AromazenInventory(ctx: Context) {
  const [qr, setQr] = useState(""), [result, setResult] = useState<Row | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0), [search, setSearch] = useState(""), [rows, setRows] = useState<Row[]>(ctx.s.cartons), [total, setTotal] = useState(ctx.s.cartonTotal), [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (ctx.work.kind !== "all" || ctx.sample) { setRows(ctx.s.cartons.filter(c => (c.id + " " + c.marking).toLowerCase().includes(search.toLowerCase()))); setTotal(ctx.s.cartons.length); return; }
    const abort = new AbortController();
    const timer = setTimeout(() => { api<Row>(`/state?workflow=StockFirst&page=${page}&pageSize=100&search=${encodeURIComponent(search)}`, { signal: abort.signal }).then(s => { setRows(s.cartons); setTotal(s.cartonTotal); }).catch(e => { if (!abort.signal.aborted) setError(e.message); }); }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [ctx.s, ctx.work.kind, ctx.sample, page, search]);
  async function lookup(e: FormEvent) { e.preventDefault(); setError(""); setBusy(true); try { const r = await api<Row>(`/cartons/lookup?qr=${encodeURIComponent(qr.trim())}`); setResult({ ...r, message: "Contents lookup only. Inventory was not changed." }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function print() { setBusy(true); setError(""); let generated = false; try { const r = await ctx.run("createLabels", { ids: selected, reason: "Generate or reprint existing AROMAZEN carton QR labels" }); generated = true; await labelPdf(r.cartons, ctx.all.company.name); } catch (e) { setError((generated ? "Inventory and QR labels are saved. Printing again will not add stock. " : "") + (e as Error).message); } finally { setBusy(false); } }
  const inventory = ctx.all.packedInventory;
  return <>
    <div className="page-heading"><div><span className="eyebrow">STEP 2 · PACKED INVENTORY</span><h1>Inventory</h1><p>Generated QR labels add cartons and their products here. Scan only when dispatching.</p></div><button className="secondary" onClick={() => { ctx.selectWork({ kind: "all" }); ctx.navigate("packing"); }}>Add packed cartons</button></div>
    <div className="home-totals"><div><strong>{number(inventory?.availableCartons ?? 0)}</strong><span>Available cartons</span></div><div><strong>{number(inventory?.pendingLabels ?? 0)}</strong><span>Cartons awaiting QR</span></div><div><strong>{number(inventory?.heldCartons ?? 0)}</strong><span>Cartons on hold</span></div></div>
    <ProductInventory ctx={ctx} />
    <section className="panel panel-padding"><h2>Look up a carton's contents</h2><form className="button-row" onSubmit={lookup}><Field label="Carton QR"><input autoComplete="off" maxLength={160} value={qr} disabled={busy} onChange={e => setQr(e.target.value)} placeholder="Scan or enter the carton QR to inspect its contents" /></Field><button className="secondary" disabled={!qr.trim() || busy || ctx.sample}>Look up contents</button></form><p>This lookup does not add stock, dispatch a carton or create a bill.</p></section>
    {result && <section className="notice" role="status">{result.message}{result.carton && <p><strong>{result.carton.id}</strong> · <Badge>{result.carton.state}</Badge><br />{content(ctx, result.carton)}</p>}</section>}
    {error && <div className="notice error" role="alert">{error}</div>}
    <section className="panel panel-padding"><div className="toolbar"><Field label="Search carton or marking"><input value={search} onChange={e => { setSearch(e.target.value); setPage(0); setSelected([]); }} /></Field><button className="secondary" disabled={!selected.length || busy || !may(ctx, "PackingClerk", "PackingSupervisor")} onClick={() => void print()}>Generate / print selected QR labels</button></div>
      <div className="table-wrap"><table><thead><tr><th>Select</th><th>Carton / marking</th><th>Products inside</th><th>Status</th></tr></thead><tbody>{rows.map(c => <tr key={c.id}><td><input type="checkbox" aria-label={`Select ${c.id}`} disabled={!["PendingLabel", "Available", "Reserved"].includes(c.state)} checked={selected.includes(c.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))} /></td><td><strong>{c.marking}</strong><small>{c.id} · revision {c.revision}</small></td><td>{content(ctx, c)}</td><td><Badge tone={c.state === "Available" && !c.held ? "sage" : "amber"}>{c.state}</Badge>{c.held && <Badge>Held</Badge>}{c.state === "PendingLabel" && <small>Generate its QR to add it to inventory.</small>}</td></tr>)}</tbody></table></div>
      {!rows.length && <p>No cartons found. Record carton contents to get started.</p>}
      {ctx.work.kind === "all" && <div className="button-row"><button disabled={page === 0 || busy} onClick={() => { setPage(n => n - 1); setSelected([]); }}>Previous</button><span>Page {page + 1} · {total} cartons</span><button disabled={(page + 1) * 100 >= total || busy} onClick={() => { setPage(n => n + 1); setSelected([]); }}>Next</button></div>}
    </section>
  </>;
}

export function AromazenDispatch(ctx: Context) {
  const [customerId, setCustomer] = useState(""), [reference, setReference] = useState(""), [destination, setDestination] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const shipmentId = ctx.work.kind === "shipment" ? ctx.work.id : null;
  const active = shipmentId ? ctx.all.shipments.find(s => s.id === shipmentId && s.state !== "Cancelled") : null;
  const customers = ctx.all.customers.filter(c => c.inTally !== false);
  async function begin(e: FormEvent) { e.preventDefault(); if (busy || hasPendingScan()) return; setBusy(true); setError(""); try { const r = await ctx.run("beginStockDispatch", { customerId, reference, destination, warehouseId: ctx.all.warehouses[0]?.id }); ctx.selectWork({ kind: "shipment", id: r.id }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (active) {
    const loadedIds = new Set(ctx.all.allocations.filter(a => a.shipmentId === active.id && a.active && a.state === "Loaded").map(a => a.cartonId));
    return <>
      <div className="notice"><strong>{ctx.all.customers.find(c => c.id === active.customerId)?.name}</strong> · {ctx.all.orders?.find(o => o.id === active.orderId)?.reference} · {active.destination}<button className="text-link" disabled={hasPendingScan()} onClick={() => ctx.selectWork({ kind: "all" })}>Choose another customer dispatch</button></div>
      <DispatchScanScreen key={active.id} {...ctx} />
      {ctx.all.billings.filter(b => b.shipmentId === active.id && b.revision === active.billingVersion).map(b => <section className="panel panel-padding" key={b.id}><h2>Draft bill from scanned cartons</h2><p>{money(b.total)} before invoice tax. Review prices and approve the bill after loading.</p>{parse<Row>(b.snapshot).lines.map((l: Row) => <p key={l.sku}>{l.sku} · {quantity(l.quantity)} {l.unit} · {money(l.net)} {l.priceMissing && <strong>— enter an approved price in Billing</strong>}</p>)}</section>)}
      <section className="panel panel-padding"><h2>Cartons in this customer dispatch</h2>{ctx.all.cartons.filter(c => loadedIds.has(c.id)).map(c => <div key={c.id}><p><strong>{c.marking}</strong> · {c.id}<br />{content(ctx, c)}</p>{!active.loadApproved && <button className="text-link" disabled={busy || hasPendingScan() || !may(ctx, "DispatchSupervisor")} onClick={async () => { const reason = window.prompt("Confirm this carton was physically removed from this load. Enter the reason:"); if (!reason || reason.trim().length < 3) return; setBusy(true); setError(""); try { await ctx.run("unload", { id: c.id, shipmentId: active.id, reason }); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }}>Unload & return carton to inventory</button>}</div>)}</section>
      {error && <div className="notice error" role="alert">{error}</div>}
    </>;
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow">STEP 3 · CUSTOMER & DISPATCH SCAN</span><h1>Dispatch cartons</h1><p>Choose the customer first. Each scanned available carton contributes all its products to one draft bill.</p></div></div>
    <form className="panel panel-padding" onSubmit={begin}>
      <Field label="Customer"><select required value={customerId} onChange={e => { setCustomer(e.target.value); const c = customers.find(c => c.id === e.target.value); setDestination(c?.tallyAddress || c?.address || ""); }}><option value="">Choose customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Order / PO reference"><input required minLength={2} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></Field>
      <Field label="Delivery destination including state"><textarea required minLength={3} maxLength={300} value={destination} onChange={e => setDestination(e.target.value)} /></Field>
      <button className="primary" disabled={busy || hasPendingScan() || !may(ctx, "DispatchSupervisor")}>Select customer & start dispatch</button>
    </form>
    {error && <div className="notice error" role="alert">{error}</div>}
    <section className="panel panel-padding"><h2>Resume a customer dispatch</h2>{ctx.all.shipments.filter(s => s.state !== "Cancelled" && s.state !== "Departed").map(s => <p key={s.id}><button className="text-link" onClick={() => ctx.selectWork({ kind: "shipment", id: s.id })}>{ctx.all.customers.find(c => c.id === s.customerId)?.name} · {ctx.all.orders?.find(o => o.id === s.orderId)?.reference}</button> · <Badge>{s.state}</Badge></p>)}</section>
  </>;
}

export function AromazenHistory(ctx: Context) {
  return <><div className="page-heading"><div><h1>Customer order history</h1><p>Review each customer's scanned cartons, draft bill and confirmed invoice.</p></div></div><section className="panel panel-padding">{(ctx.all.orders ?? []).map(order => <div key={order.id}><h2>{order.reference} · {ctx.all.customers.find(c => c.id === order.customerId)?.name}</h2><p>{order.destination} · {date(order.createdAt)} · <Badge>{order.state}</Badge></p>{ctx.all.shipments.filter(s => s.orderId === order.id).map(sh => <p key={sh.id}><Badge>{sh.state}</Badge> <button className="text-link" onClick={() => { if (ctx.selectWork({ kind: "shipment", id: sh.id })) ctx.navigate(sh.loadApproved ? "billing" : "trips"); }}>{sh.loadApproved ? "Review bill & invoice" : "Resume dispatch"}</button></p>)}</div>)}{!ctx.all.orders?.length && <p>No customer dispatches yet.</p>}</section></>;
}
