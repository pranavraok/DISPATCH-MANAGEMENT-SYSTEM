import { useState } from "react";
import { ArrowRight, Boxes, ClipboardList, Plus, Trash2, Settings, Printer, ScanLine } from "lucide-react";
import { Badge, Empty, Field, Modal, type Context } from "./main";
import { number, parse, type Line, type Row } from "./domain";
import { shortReference } from "./codes";
import { orderCartons, workflows, type Workflow } from "./workflow";
import { readWorkstation, saveWorkstation } from "./workstation";
import { brand } from "./brand";

export function WorkflowChooser({ choose, user, openSettings, signOut, error }: { choose: (workflow: Workflow) => void; user: Row; openSettings: () => void; signOut: () => void; error?: string }) {
  return <main className="workflow-picker">
    <header className="workflow-picker-header"><div className="brand-mark">E</div><div><strong>{brand.name}</strong><span>Dispatch management</span></div><button className="text-link" onClick={signOut}>Sign out</button></header>
    <section className="workflow-intro"><span className="eyebrow">YOUR DISPATCH WORKSPACE</span><h1>How are we preparing this dispatch?</h1><p>Choose a workflow to test. You can switch at any time.</p></section>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="workflow-options">{(["StockFirst", "OrderFirst"] as Workflow[]).map((flow, index) => {
      const item = workflows[flow], Icon = flow === "StockFirst" ? Boxes : ClipboardList;
      return <button className={"workflow-option " + (flow === "OrderFirst" ? "order-first" : "stock-first")} onClick={() => choose(flow)} key={flow}>
        <span className="workflow-option-top"><span className="workflow-icon"><Icon size={27} /></span><span>WORKFLOW {index + 1}</span></span>
        <h2>{item.title}</h2><strong>{item.subtitle}</strong><p>{item.description}</p>
        <span className="workflow-mini-steps">{item.steps.slice(0, 3).map((step, i) => <span key={step}>{i > 0 && <ArrowRight size={13} />}{step}</span>)}</span>
        <span className="workflow-open">Open dashboard <ArrowRight size={19} /></span>
      </button>;
    })}</div>
    <section className="shared-setup-note"><Settings size={20} /><div><strong>One setup for both workflows</strong><p>The same Tally connection, scanner, printers, customers and products are used in both.</p></div><button className="secondary" onClick={openSettings}>Shared settings</button></section>
    <p className="workflow-user">Signed in as {user.name}</p>
  </main>;
}

export function OrdersScreen(ctx: Context) {
  const s = ctx.all, workflow = ctx.workflow ?? "StockFirst", orders = s.orders ?? [];
  const [open, setOpen] = useState(false), [removing, setRemoving] = useState<Row | null>(null), [reason, setReason] = useState("");
  const canCreate = !ctx.sample && ctx.user.roles.some((r: string) => ["Admin", "DispatchSupervisor", "PackingSupervisor", "Billing"].includes(r));
  const canDelete = !ctx.sample && ctx.user.roles.some((r: string) => ["Admin", "DispatchSupervisor"].includes(r));
  function pack(order: Row) {
    if (!ctx.selectWork({ kind: "all" })) return;
    const url = new URL(window.location.href); url.searchParams.set("order", order.id); window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    ctx.navigate("packing");
  }
  return <>
    <div className="page-heading"><div><h1>Customer orders</h1><p>{workflow === "StockFirst" ? "An order has arrived. Choose from the stock you already packed and labelled." : "Start here. Record an order before packing and labelling its cartons."}</p></div><button className="primary" onClick={() => setOpen(true)} disabled={!canCreate}><Plus size={17} />New order</button></div>
    {orders.length ? <div className="record-card-grid order-card-grid">{orders.map(order => {
      const assigned = orderCartons(s, order), manifests = s.manifests.filter(m => m.orderId === order.id);
      const packed = s.orderProgress?.find(row => row.orderId === order.id)?.packedCartons ?? s.cartons.filter(c => manifests.some(m => m.id === c.manifestId) && c.state !== "Retired").length;
      return <section className="panel order-card" key={order.id}>
        <div className="work-card-top"><span className="work-card-kind">Customer order</span><Badge tone={assigned >= order.expectedCartons ? "sage" : "amber"}>{assigned >= order.expectedCartons ? "Cartons assigned" : "Open"}</Badge></div>
        <h2>{order.reference}</h2><strong>{s.customers.find(c => c.id === order.customerId)?.name ?? order.customerId}</strong><p>{order.destination}</p><small title={order.id}>{shortReference(order.id)}</small>
        <div className="work-card-facts"><div><span>Expected cartons</span><strong>{number(order.expectedCartons)}</strong></div><div><span>Assigned to trips</span><strong>{number(assigned)}</strong></div>{workflow === "OrderFirst" && <div><span>Packed so far</span><strong>{number(packed)}</strong></div>}</div>
        <details className="order-contents"><summary>Order details</summary>{parse<Line[]>(order.lines).length ? parse<Line[]>(order.lines).map((line, i) => <p key={i}>{line.sku}: {line.quantity} {line.unit}</p>) : <p>Carton count only. Review the product mix before billing.</p>}{order.notes && <p>{order.notes}</p>}</details>
        <div className="button-row">{workflow === "OrderFirst" && <button className="primary" disabled={!canCreate || packed >= order.expectedCartons} onClick={() => pack(order)}>Pack this order <ArrowRight size={16} /></button>}<button className="secondary" onClick={() => { if (ctx.selectWork({ kind: "all" })) ctx.navigate("trips"); }}>Prepare shipment</button></div>
        {canDelete && !manifests.length && !s.shipments.some(sh => sh.orderId === order.id) && <button className="text-link danger" onClick={() => { setRemoving(order); setReason(""); }}><Trash2 size={14} />Delete unused order</button>}
      </section>;
    })}</div> : <section className="panel"><Empty title="No customer orders yet" detail={workflow === "OrderFirst" ? "Add the first order, then pack its cartons." : "Your packed stock can stay ready here until an order arrives."} /></section>}
    {open && <OrderEditor ctx={ctx} close={() => setOpen(false)} />}
    {removing && <Modal title="Delete unused order" close={() => setRemoving(null)}><p>Delete <strong>{removing.reference}</strong>? Only orders without packing or shipment history can be deleted.</p><form onSubmit={async e => { e.preventDefault(); try { await ctx.run("deleteOrder", { id: removing.id, reason, confirmed: true }); setRemoving(null); } catch { /* The app displays the server error. */ } }}><Field label="Reason"><input required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></Field><button className="primary destructive" disabled={reason.trim().length < 3}>Delete order</button></form></Modal>}
  </>;
}

export function OrderPicker({ ctx, value, onChange, disabled = false, required = false }: { ctx: Context; value: string; onChange: (value: string) => void; disabled?: boolean; required?: boolean }) {
  return <Field label="Customer order"><select aria-label="Customer order" value={value} required={required} disabled={disabled} onChange={e => onChange(e.target.value)}>
    <option value="">{required ? "Choose the received order" : "Choose an order (optional)"}</option>
    {(ctx.all.orders ?? []).filter(o => o.state === "Open" || o.id === value).map(order => <option key={order.id} value={order.id}>{order.reference} · {ctx.all.customers.find(c => c.id === order.customerId)?.name} · {order.expectedCartons} cartons</option>)}
  </select></Field>;
}

export function SharedMasters({ ctx }: { ctx: Context }) {
  const [kind, setKind] = useState<"product" | "customer" | null>(null), [name, setName] = useState(""), [sku, setSku] = useState(""), [unit, setUnit] = useState("Nos"), [address, setAddress] = useState(""), [nativeId, setNative] = useState(""), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const canManage = !ctx.sample && ctx.user.roles.some((role: string) => ["Admin", "Billing"].includes(role));
  function open(value: "product" | "customer") { setKind(value); setName(""); setSku(""); setUnit("Nos"); setAddress(""); setNative(""); setError(""); }
  return <section className="panel panel-padding shared-masters"><div className="panel-heading"><div><h2>Customers & products</h2><p>One shared list for both workflows. Add your actual items and customers before testing.</p></div><div className="button-row"><button className="secondary small" disabled={!canManage} onClick={() => open("product")}><Plus size={15} />Add product</button><button className="secondary small" disabled={!canManage} onClick={() => open("customer")}><Plus size={15} />Add customer</button></div></div>
    <div className="form-grid"><details><summary>Products ({ctx.all.products.length})</summary>{ctx.all.products.length ? ctx.all.products.map(p => <p key={p.id}><strong>{p.sku}</strong> · {p.name} · {p.unit}</p>) : <p>No products yet.</p>}</details><details><summary>Customers ({ctx.all.customers.length})</summary>{ctx.all.customers.length ? ctx.all.customers.map(c => <p key={c.id}><strong>{c.name}</strong><br />{c.address}</p>) : <p>No customers yet.</p>}</details></div>
    {kind && <Modal title={kind === "product" ? "Add shared product" : "Add shared customer"} close={() => { if (!saving) setKind(null); }}><form onSubmit={async e => {
      e.preventDefault(); if (saving) return; setSaving(true); setError("");
      try { await ctx.run(kind === "product" ? "saveProduct" : "saveCustomer", kind === "product" ? { name, sku, unit, tallyId: nativeId, tallyName: name, reason: "Shared product setup" } : { name, address, tallyId: nativeId, reason: "Shared customer setup" }); setKind(null); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
    }}><Field label={kind === "product" ? "Product name" : "Customer name"}><input required minLength={2} value={name} onChange={e => setName(e.target.value)} /></Field>{kind === "product" ? <><Field label="Exact item code / SKU"><input required maxLength={50} value={sku} onChange={e => setSku(e.target.value)} /></Field><Field label="Base unit"><input required value={unit} onChange={e => setUnit(e.target.value)} /></Field></> : <Field label="Customer address"><textarea required minLength={3} value={address} onChange={e => setAddress(e.target.value)} /></Field>}<Field label="Tally master ID (optional until integration)"><input value={nativeId} onChange={e => setNative(e.target.value)} /></Field><p className="muted">This saves the shared dispatch record. It does not create a master in Tally.</p>{error && <p className="notice error" role="alert">{error}</p>}<button className="primary wide" disabled={saving}>{saving ? "Saving…" : "Save for both workflows"}</button></form></Modal>}
  </section>;
}

function OrderEditor({ ctx, close }: { ctx: Context; close: () => void }) {
  const [reference, setReference] = useState(""), [customerId, setCustomer] = useState(ctx.all.customers[0]?.id ?? ""), [destination, setDestination] = useState(""), [expectedCartons, setCartons] = useState("1"), [notes, setNotes] = useState(""), [lines, setLines] = useState<Line[]>([]), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const products = ctx.all.products;
  return <Modal title="New customer order" close={() => { if (!saving) close(); }}><form onSubmit={async e => {
    e.preventDefault(); if (saving) return; setSaving(true); setError("");
    try { await ctx.run("createOrder", { reference, customerId, destination, expectedCartons: Number(expectedCartons), warehouseId: ctx.all.warehouses[0]?.id, lines, notes }); close(); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }}>
    {!ctx.all.customers.length && <p className="notice amber">Add a customer in Shared settings first.</p>}
    <Field label="Order / purchase order reference"><input required minLength={2} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} placeholder="PO-1024" /></Field>
    <Field label="Customer"><select required value={customerId} onChange={e => setCustomer(e.target.value)}>{ctx.all.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    <Field label="Delivery destination"><input required minLength={3} maxLength={300} value={destination} onChange={e => setDestination(e.target.value)} placeholder="Customer site / delivery address" /></Field>
    <Field label="Total cartons ordered"><input required type="number" min={1} max={10000} value={expectedCartons} onChange={e => setCartons(e.target.value)} /></Field>
    <details className="order-requirements"><summary>Product quantities (optional)</summary><p>Enter totals for the entire order to check the product mix. Leave empty when only the carton count is known.</p>
      {lines.map((line, i) => <div className="content-line" key={i}><select aria-label="Required product" value={line.sku} onChange={e => setLines(previous => previous.map((item, j) => j === i ? { ...item, sku: e.target.value, unit: products.find(p => p.sku === e.target.value)?.unit ?? "" } : item))}>{products.map(p => <option key={p.id} value={p.sku}>{p.sku} · {p.name}</option>)}</select><input aria-label="Required product quantity" required inputMode="decimal" value={line.quantity} onChange={e => setLines(previous => previous.map((item, j) => j === i ? { ...item, quantity: e.target.value } : item))} /><span>{line.unit}</span><button type="button" className="text-link danger" aria-label="Remove product requirement" onClick={() => setLines(previous => previous.filter((_, j) => j !== i))}><Trash2 size={15} /></button></div>)}
      <button type="button" className="secondary small" disabled={!products.length} onClick={() => setLines(previous => [...previous, { sku: products[0].sku, quantity: "1", unit: products[0].unit }])}>Add product requirement</button>
    </details>
    <Field label="Order notes"><textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    {error && <p className="notice error" role="alert">{error}</p>}<button className="primary wide" disabled={saving || !customerId}>{saving ? "Saving order…" : "Save order"}</button>
  </form></Modal>;
}

export function WorkstationSettings({ ctx }: { ctx: Context }) {
  const company = ctx.all.company.id ?? "demo";
  const [station, setStation] = useState(() => readWorkstation(company).station), [message, setMessage] = useState("");
  return <section className="panel panel-padding shared-devices"><h2>Scanner & printers on this computer</h2><p>One workstation setup serves both workflows. Your scanner uses its existing USB / receiver connection; printers use the browser print dialog.</p>
    <form onSubmit={e => { e.preventDefault(); try { saveWorkstation(company, station); setMessage("Workstation saved for both workflows on this computer."); } catch (e) { setMessage((e as Error).message); } }}><Field label="Scanner workstation name"><input minLength={2} maxLength={80} required value={station} onChange={e => setStation(e.target.value)} disabled={ctx.sample} /></Field><button className="secondary" disabled={ctx.sample}>Save workstation</button></form>
    {message && <p role="status">{message}</p>}<div className="shared-device-facts"><span><ScanLine size={17} />One scan per carton, in Labels</span><span><Printer size={17} />Same A4 label and document printing</span></div><p className="muted">Use a different workstation name on each computer. Workflow switching does not reconnect devices or pair Tally again.</p>
  </section>;
}
