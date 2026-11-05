import { AromazenPackingPresets, AromazenSuggestions, AromazenBatchTrace, AromazenStockCheck, AromazenCartonManager, AromazenCancelOrder } from "./aromazen-tools";
import { Package, Boxes, ScanLine, ArrowRight } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Badge, Field, Modal, type Context } from "./main";
import { api } from "./api";
import { date, money, number, parse, type Line, type Row } from "./domain";
import { labelPdf } from "./labels";
import { DispatchScanScreen, hasPendingScan } from "./scanner";

const may = (ctx: Context, ...roles: string[]) => !ctx.sample && ctx.user.roles.some((r: string) => r === "Admin" || roles.includes(r));
const quantity = (value: number | string) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 }).format(Number(value));
const content = (ctx: Context, carton: Row) => parse<Line[]>(carton.lines).map(l => `${ctx.all.products.find(p => p.sku === l.sku)?.name ?? l.sku}: ${quantity(l.quantity)} ${l.unit}`).join(" + ");

export function AromazenBatchFilter({ ctx }: { ctx: Context }) {
  const selectedBatch = ctx.work.kind === "packing" ? ctx.work.id : ctx.work.kind === "all" ? "" : "selected-order";
  return <section className="panel panel-padding"><Field label="Packing batch"><select value={selectedBatch} onChange={e => ctx.selectWork(e.target.value ? { kind: "packing", id: e.target.value } : { kind: "all" })}>
    <option value="">All batches</option>
    {selectedBatch === "selected-order" && <option value="selected-order" disabled>Cartons for the selected order</option>}
    {ctx.all.manifests.map(batch => <option key={batch.id} value={batch.id}>{batch.name}{batch.createdAt ? " · " + new Date(batch.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}</option>)}
  </select></Field>{selectedBatch && <button className="text-link" onClick={() => ctx.selectWork({ kind: "all" })}>Show all batches</button>}</section>;
}

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
  const [dashboard,setDashboard]=useState<Row|null>(null),[error,setError]=useState("");
  useEffect(()=>{
    if(ctx.sample) return;
    const abort=new AbortController();
    api<Row>("/aromazen/dashboard",{signal:abort.signal}).then(data=>{if(!data.inventory||!data.pending||!data.recent||!data.tally)throw Error("Home summary is unavailable.");setDashboard(data);setError("");}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return()=>abort.abort();
  },[ctx.sample,ctx.all.serverTime]);
  const inventory=dashboard?.inventory ?? ctx.all.packedInventory;
  const tasks=[
    {title:"Pack cartons",detail:"Enter products and print QR labels.",page:"packing",Icon:Package},
    {title:"Check stock",detail:"See ready cartons and products.",page:"cartons",Icon:Boxes},
    {title:"Dispatch order",detail:"Choose a customer and scan cartons.",page:"trips",Icon:ScanLine},
  ];
  const pendingTasks=[
    {key:"dispatches",title:"Finish dispatching",action:"Resume",page:"trips"},
    {key:"bills",title:"Bills to approve",action:"Review",page:"billing"},
    {key:"readyInvoices",title:"Ready for Tally",action:"Open",page:"billing"},
    {key:"tallyIssues",title:"Invoices to check",action:"Check",page:"billing"},
  ];
  function open(page:string) {if(ctx.selectWork({kind:"all"}))ctx.navigate(page);}
  function resume(id:string,page:string) {if(ctx.selectWork({kind:"shipment",id}))ctx.navigate(page);}
  const recent=(dashboard?.recent?.orders ?? []).slice(0,5);
  return <section className="az-home">
    <div className="page-heading"><div><h1>What do you want to do?</h1></div></div>
    <nav className="az-home-tasks" aria-label="Main tasks">{tasks.map(({title,detail,page,Icon})=><button key={page} className="az-home-task" onClick={()=>open(page)}><Icon size={34} aria-hidden="true"/><strong>{title}</strong><span>{detail}</span><ArrowRight size={22} aria-hidden="true"/></button>)}</nav>
    {error && <p className="notice error" role="alert">Home could not update. Displayed figures may be old. <button className="text-link" onClick={()=>void ctx.refresh()}>Refresh</button></p>}
    <div className="home-totals az-home-counts" aria-label="Carton counts">{[
      [inventory?.availableCartons,"Cartons ready"],[inventory?.pendingLabels,"Waiting for QR labels"],[inventory?.heldCartons,"Cartons on hold"],[inventory?.loadedCartons,"Cartons in dispatch"],
    ].map(([value,label])=><div key={String(label)}><strong>{value==null?"—":number(Number(value))}</strong><span>{label}</span></div>)}</div>
    <section className="az-home-section" aria-labelledby="az-pending-heading"><h2 id="az-pending-heading">Needs attention</h2><div className="az-attention-grid">{pendingTasks.map(task=>{
      const pending=dashboard?.pending?.[task.key];
      return <section className="panel az-attention-card" key={task.key}><div className="az-section-heading"><h3>{task.title}</h3><strong className="az-task-count">{pending?number(pending.count):"—"}</strong></div>
        {!pending && <p>{ctx.sample?"Sign in to see pending work.":"Loading…"}</p>}
        {pending?.count===0 && <p>Nothing pending</p>}
        {pending?.items.slice(0,2).map((item:Row)=><div className="az-attention-item" key={item.shipmentId}><div><strong>{item.customer}</strong><small>{item.reference}</small></div><button className="secondary small" onClick={()=>resume(item.shipmentId,task.page)}>{task.action}</button></div>)}
        {pending?.count>2 && <button className="text-link" onClick={()=>open(task.page==="trips"?"orders":"billing")}>View all {number(pending.count)}</button>}
      </section>;
    })}</div></section>
    <div className="az-home-data-grid">
      <section className="panel panel-padding"><div className="az-section-heading"><h2>Products ready</h2><button className="text-link" onClick={()=>open("cartons")}>View all stock</button></div>
        {inventory?.products.length?<div className="table-wrap az-stock-table"><table><thead><tr><th>Product</th><th>Available quantity</th><th>Cartons</th></tr></thead><tbody>{inventory.products.slice(0,6).map((product:Row)=><tr key={product.sku+"|"+product.unit}><td>{product.name ?? ctx.all.products.find(p=>p.sku===product.sku)?.name ?? product.sku}</td><td>{quantity(product.quantity)} {product.unit}</td><td>{number(product.cartons)}</td></tr>)}</tbody></table></div>:<p>No products ready yet.</p>}
        {inventory?.products.length>6 && <small>{number(inventory.products.length)} product/unit balances. Open stock to see all.</small>}
      </section>
      <section className="panel panel-padding"><div className="az-section-heading"><h2>Tally</h2><Badge tone={dashboard?.tally.status==="Connected"?"sage":"amber"}>{dashboard?.tally.status ?? (ctx.sample?"Sample":"Checking…")}</Badge></div>
        <p>Last product & customer sync</p><strong>{dashboard?.tally.lastSync?date(dashboard.tally.lastSync):dashboard?"Not synced yet":"—"}</strong>
        {dashboard && !dashboard.tally.invoiceSetupReady && <p className="notice amber">Invoice setup needs checking by accounts.</p>}
        <button className="text-link" onClick={()=>open("setup")}>Open Tally settings</button>
      </section>
    </div>
    <section className="panel panel-padding az-home-section"><div className="az-section-heading"><h2>Recent orders</h2><button className="text-link" onClick={()=>open("orders")}>View all orders</button></div>
      {recent.length?<div className="az-recent-orders">{recent.map(({order,customerName,shipments}:Row)=>{
        const current=shipments.find((s:Row)=>!["Invoice confirmed","Cancelled"].includes(s.stage)) ?? shipments[0];
        const cancelled=order.state==="Cancelled";
        return <div className="az-recent-order" key={order.id}><div><strong>{customerName}</strong><small>{order.reference}</small></div><span>{number(shipments.reduce((n:number,s:Row)=>n+s.scannedCartons,0))} {shipments.reduce((n:number,s:Row)=>n+s.scannedCartons,0)===1?"carton":"cartons"}</span><Badge>{cancelled?"Cancelled":current?.stage ?? "Not started"}</Badge><button className="secondary small" onClick={()=>cancelled||!current?open("orders"):resume(current.shipment.id,current.shipment.loadApproved?"billing":"trips")}>{cancelled||!current?"View order":current.stage==="Invoice confirmed"?"View invoice":current.shipment.loadApproved?"Review bill":"Resume"}</button></div>;
      })}</div>:<p>{dashboard?"No orders yet.":ctx.sample?"Sign in to see recent orders.":"Loading orders…"}</p>}
    </section>
    <div className="az-home-links"><button className="secondary" onClick={()=>open("billing")}>Bills & invoices <ArrowRight size={16} aria-hidden="true"/></button><button className="secondary" onClick={()=>open("orders")}>Past orders <ArrowRight size={16} aria-hidden="true"/></button></div>
    <details className="panel panel-padding az-home-section"><summary>Help with these numbers</summary><p>Cartons become ready when their QR labels are generated. Cartons on hold and cartons already scanned for dispatch are not available stock.</p><p>A mixed carton appears against each product inside it. Do not add the product-row carton counts together; use the total “Cartons ready” above.</p><p>“Invoices to check” needs attention from accounts. An invoice is complete only after Tally confirms it.</p></details>
    {dashboard?.updatedAt && <small className="az-home-updated">Updated {date(dashboard.updatedAt)}</small>}
  </section>;
}

export type ProductDraft = { sku: string; quantity: string; productionBatch?: string };
export type CartonDraft = { marking: string; count: string; lines: ProductDraft[] };
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
    <AromazenPackingPresets ctx={ctx} groups={groups} onApply={setGroups} />
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
        <details><summary>Manufacturing batch references (optional)</summary>{group.lines.map((line,li)=><Field key={li} label={`Group ${gi+1} product ${li+1} manufacturing batch`}><input maxLength={80} value={line.productionBatch??""} onChange={e=>updateLine(gi,li,{productionBatch:e.target.value})}/></Field>)}</details>
        <div className="button-row"><button type="button" className="secondary small" disabled={group.lines.length >= 100} onClick={() => updateGroup(gi, { lines: [...group.lines, { sku: "", quantity: "1" }] })}>Add another product to these cartons</button>{groups.length > 1 && <button type="button" className="text-link" onClick={() => setGroups(prev => prev.filter((_, i) => i !== gi))}>Remove carton group {gi + 1}</button>}</div>
      </section>)}
      <div className="button-row"><button type="button" className="secondary" onClick={() => setGroups(prev => [...prev, newGroup(prev.length)])}>Add another carton group</button><strong>{number(totalCartons)} cartons in this plan</strong><button className="primary" disabled={busy || !products.length || totalCartons < 1 || totalCartons > 1000 || !may(ctx, "PackingClerk", "PackingSupervisor")}>{busy ? "Saving…" : "Save carton contents"}</button></div>
      {totalCartons > 1000 && <p className="notice amber">Create at most 1,000 cartons per label batch. Split larger packing runs into separate batches.</p>}
      {!products.length && <p>Add AROMAZEN products in Settings before recording cartons.</p>}
    </form>
    {error && <div className="notice error" role="alert">{error}</div>}
    <section className="panel panel-padding"><h2>Recorded packing batches</h2>{ctx.all.manifests.filter(m => ctx.work.kind !== "packing" || ctx.work.id === m.id).map(m => <p key={m.id}><strong>{m.name}</strong> · {date(m.createdAt)} <button className="text-link" onClick={() => { if (ctx.selectWork({ kind: "packing", id: m.id })) ctx.navigate("cartons"); }}>View cartons & labels</button></p>)}</section>
  </>;
}

export function AromazenInventory(ctx: Context) {
  const [qr, setQr] = useState(""), [result, setResult] = useState<Row | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [manageId,setManageId]=useState<string|null>(null);
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
    <AromazenBatchTrace ctx={ctx} /><AromazenStockCheck ctx={ctx}/>{manageId&&<AromazenCartonManager ctx={ctx} id={manageId} close={()=>setManageId(null)}/>}
    <section className="panel panel-padding"><h2>Look up a carton's contents</h2><form className="button-row" onSubmit={lookup}><Field label="Carton QR"><input autoComplete="off" maxLength={160} value={qr} disabled={busy} onChange={e => setQr(e.target.value)} placeholder="Scan or enter the carton QR to inspect its contents" /></Field><button className="secondary" disabled={!qr.trim() || busy || ctx.sample}>Look up contents</button></form><p>This lookup does not add stock, dispatch a carton or create a bill.</p></section>
    {result && <section className="notice" role="status">{result.message}{result.carton && <p><strong>{result.carton.id}</strong> · <Badge>{result.carton.state}</Badge><br />{content(ctx, result.carton)}</p>}{result.productionBatches?.map((b:Row)=><p key={b.sku}>Manufacturing batch · {ctx.all.products.find(p=>p.sku===b.sku)?.name??b.sku}: <strong>{b.batch}</strong></p>)}</section>}
    {error && <div className="notice error" role="alert">{error}</div>}
    <section className="panel panel-padding"><div className="toolbar"><Field label="Search carton or marking"><input value={search} onChange={e => { setSearch(e.target.value); setPage(0); setSelected([]); }} /></Field><button className="secondary" disabled={!selected.length || busy || !may(ctx, "PackingClerk", "PackingSupervisor")} onClick={() => void print()}>Generate / print selected QR labels</button></div>
      <div className="table-wrap"><table><thead><tr><th>Select</th><th>Carton / marking</th><th>Products inside</th><th>Status / actions</th></tr></thead><tbody>{rows.map(c => <tr key={c.id}><td><input type="checkbox" aria-label={`Select ${c.id}`} disabled={!["PendingLabel", "Available", "Reserved"].includes(c.state)} checked={selected.includes(c.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))} /></td><td><strong>{c.marking}</strong><small>{c.id} · revision {c.revision}</small></td><td>{content(ctx, c)}</td><td><Badge tone={c.state === "Available" && !c.held ? "sage" : "amber"}>{c.state}</Badge>{c.held && <Badge>Held</Badge>}{c.state === "PendingLabel" && <small>Generate its QR to add it to inventory.</small>}<button className="text-link" onClick={()=>setManageId(c.id)}>Check / correct carton</button></td></tr>)}</tbody></table></div>
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
      <AromazenSuggestions ctx={ctx} shipment={active} />
      <DispatchScanScreen key={active.id} {...ctx} />
      {ctx.all.billings.filter(b => b.shipmentId === active.id && b.revision === active.billingVersion).map(b => <section className="panel panel-padding" key={b.id}><h2>Draft bill from scanned cartons</h2><p>{money(b.total)} before invoice tax. Review prices and approve the bill after loading.</p>{parse<Row>(b.snapshot).lines.map((l: Row) => <p key={l.sku}>{l.sku} · {quantity(l.quantity)} {l.unit} · {money(l.net)} {l.priceMissing && <strong>— enter an approved price in Billing</strong>}</p>)}</section>)}
      <section className="panel panel-padding"><h2>Cartons in this customer dispatch</h2>{ctx.all.cartons.filter(c => loadedIds.has(c.id)).map(c => <div key={c.id}><p><strong>{c.marking}</strong> · {c.id}<br />{content(ctx, c)}</p>{!active.loadApproved && <button className="text-link" disabled={busy || hasPendingScan() || !may(ctx, "DispatchSupervisor")} onClick={async () => { const reason = window.prompt("Confirm this carton was physically removed from this load. Enter the reason:"); if (!reason || reason.trim().length < 3) return; setBusy(true); setError(""); try { await ctx.run("unload", { id: c.id, shipmentId: active.id, reason }); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }}>Unload & return carton to inventory</button>}</div>)}</section>
      {error && <div className="notice error" role="alert">{error}</div>}
    </>;
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow">STEP 3 · CUSTOMER & DISPATCH SCAN</span><h1>Dispatch an order</h1><p>Choose the customer first. Each scanned available carton contributes all its products to one draft bill.</p></div></div>
    <form className="panel panel-padding" onSubmit={begin}>
      <Field label="Customer"><select required value={customerId} onChange={e => { setCustomer(e.target.value); const c = customers.find(c => c.id === e.target.value); setDestination(c?.tallyAddress || c?.address || ""); }}><option value="">Choose customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Order / PO reference"><input required minLength={2} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></Field>
      <Field label="Delivery destination including state"><textarea required minLength={3} maxLength={300} value={destination} onChange={e => setDestination(e.target.value)} /></Field>
      <button className="primary" disabled={busy || hasPendingScan() || !may(ctx, "DispatchSupervisor")}>Select customer & start dispatch</button>
    </form>
    {error && <div className="notice error" role="alert">{error}</div>}
    <section className="panel panel-padding"><h2>Resume a customer dispatch</h2>{ctx.all.shipments.filter(s => s.state !== "Cancelled" && s.state !== "Departed").map(s => <p key={s.id}><button className="text-link" onClick={() => (ctx.selectWork({ kind: "shipment", id: s.id }) && ctx.navigate(s.loadApproved ? "billing" : "trips"))}>{ctx.all.customers.find(c => c.id === s.customerId)?.name} · {ctx.all.orders?.find(o => o.id === s.orderId)?.reference}</button> · <Badge>{s.state}</Badge></p>)}</section>
  </>;
}

export function dispatchStage(ctx: Context, shipment: Row) {
  if (shipment.state === "Cancelled") return "Cancelled";
  const jobs = ctx.all.jobs.filter(j => j.shipmentId === shipment.id && j.state !== "Retired");
  if (jobs.some(j => j.state === "Confirmed")) return "Invoice confirmed";
  if (jobs.length) return "Tally pending";
  if (shipment.loadApproved) return "Review bill";
  return "Scanning";
}

export function AromazenOrderTools(ctx: Context) {
  const [open, setOpen] = useState(false);
  function start(newTab: boolean) {
    if (hasPendingScan()) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("work"); url.searchParams.delete("order"); url.searchParams.delete("labels");
    url.searchParams.set("newOrder", "1"); url.hash = "trips";
    if (newTab) window.open(url.href, "_blank", "noopener,noreferrer");
    else if (ctx.selectWork({ kind: "all" })) { window.history.replaceState(null, "", url); ctx.navigate("trips"); }
    setOpen(false);
  }
  return <><button className="primary" disabled={hasPendingScan() || !may(ctx, "DispatchSupervisor")} onClick={() => setOpen(true)}>Start new order</button>
    {open && <Modal title="Start new order" close={() => setOpen(false)}><p>Accepted scans and saved bill details stay with the current order. Its cartons remain allocated until explicitly unloaded. Finish saving any open bill edits before switching.</p><div className="button-row"><button className="primary" onClick={() => start(true)}>Open in new tab</button><button className="secondary" onClick={() => start(false)}>Keep saved work & start new order</button></div><p>The 2D scanner sends scans to the focused tab. Check the customer before scanning.</p></Modal>}
  </>;
}

export function AromazenDispatchProgress(ctx: Context & { requireSelection?: boolean }) {
  const selectedId = ctx.work.kind === "shipment" ? ctx.work.id : null;
  const shipment = ctx.all.shipments.find(s => s.id === selectedId);
  if (ctx.requireSelection && !shipment) return null;
  const stage = shipment ? dispatchStage(ctx, shipment) : "Customer";
  const current = !shipment ? 0 : !shipment.loadApproved ? 1 : stage === "Review bill" ? 2 : 3;
  return <>{shipment && <section className="az-dispatch-context"><div><strong>{ctx.all.customers.find(c=>c.id===shipment.customerId)?.name}</strong><p>{ctx.all.orders?.find(o=>o.id===shipment.orderId)?.reference} · {shipment.destination}</p></div><Badge>{stage}</Badge>{shipment.loadApproved&&!shipment.invoiceJobId&&may(ctx,"DispatchSupervisor")&&<details><summary>Correct a loading mistake</summary><button className="text-link" disabled={hasPendingScan()} onClick={async()=>{const reason=window.prompt("Why must this load be corrected? The load and bill will need checking again.");if(!reason||reason.trim().length<3)return;try{await ctx.run("reopenStockLoad",{id:shipment.id,reason,physicalConfirmed:true});ctx.navigate("trips");}catch{ /* The app displays the error. */ }}}>Reopen loading for correction</button></details>}</section>}<nav className="az-dispatch-steps" aria-label="Dispatch progress">{["Customer & order", "Scan cartons", "Review & approve bill", "Tally invoice"].map((label, i) => <span key={label} className={stage === "Invoice confirmed" || i < current ? "complete" : i === current ? "current" : ""}><b>{i + 1}</b>{label}</span>)}</nav></>;
}

export function AromazenHistory(ctx: Context) {
  const [search,setSearch]=useState(""),[status,setStatus]=useState("All"),[page,setPage]=useState(0),[result,setResult]=useState<Row>({orders:[],total:0}),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const abort=new AbortController();setBusy(true);
    const timer=setTimeout(()=>{
      api<Row>(`/aromazen/orders?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&page=${page}`,{signal:abort.signal}).then(r=>{setResult(r);setError("");}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    },200);
    return()=>{clearTimeout(timer);abort.abort();};
  },[search,status,page,ctx.all.serverTime]);
  return <><div className="page-heading"><div><span className="eyebrow">AROMAZEN DISPATCH</span><h1>Past orders</h1><p>Resume unfinished dispatches or review bills and confirmed invoices.</p></div></div>
    <section className="panel panel-padding"><div className="form-grid"><Field label="Search customer, order or destination"><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} /></Field><Field label="Order status"><select value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}>{["All","Scanning","Review bill","Tally pending","Invoice confirmed","Cancelled"].map(s=><option key={s}>{s}</option>)}</select></Field></div></section>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="record-card-grid" aria-busy={busy}>{result.orders.map(({order,shipments,customerName}:Row)=><section className="panel panel-padding" key={order.id}><h2>{order.reference}</h2><strong>{customerName ?? ctx.all.customers.find(c=>c.id===order.customerId)?.name}</strong><p>{order.destination} · {date(order.createdAt)}</p>{order.state==="Cancelled" && <Badge>Cancelled · history kept</Badge>}
      {shipments.map(({shipment,stage,scannedCartons,snapshot,lines,billTotal}:Row)=><div className="az-history-shipment" key={shipment.id}><Badge>{stage}</Badge><p>{scannedCartons} cartons scanned{billTotal!=null ? ` · ${money(billTotal)} before invoice tax` : ""}</p><details><summary>Product quantities in this dispatch</summary>{(lines ?? (snapshot ? parse<Row>(snapshot).lines : [])).map((line:Row)=><p key={line.sku}>{ctx.all.products.find(p=>p.sku===line.sku)?.name ?? line.sku}: {quantity(line.quantity)} {line.unit}</p>)}</details><button className="secondary" disabled={hasPendingScan()} onClick={()=>{if(ctx.selectWork({kind:"shipment",id:shipment.id}))ctx.navigate(shipment.loadApproved?"billing":"trips");}}>{stage==="Invoice confirmed"?"View invoice":shipment.loadApproved?"Review bill & invoice":"Resume scanning"}</button></div>)}
      <AromazenCancelOrder ctx={ctx} order={order}/>
    </section>)}</div>{!busy && !result.orders.length && <section className="panel panel-padding"><p>No matching customer orders.</p></section>}
    <div className="button-row"><button className="secondary" disabled={busy || page===0} onClick={()=>setPage(p=>p-1)}>Previous orders</button><span>Page {page+1} · {result.total} orders</span><button className="secondary" disabled={busy || (page+1)*20>=result.total} onClick={()=>setPage(p=>p+1)}>Next orders</button></div></>;
}
