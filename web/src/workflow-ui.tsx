import { useState } from "react";
import { ArrowRight, Boxes, ClipboardList, Plus, Trash2, Settings, Printer, ScanLine } from "lucide-react";
import { Badge, Empty, Field, Modal, type Context } from "./main";
import { number, parse, type Group, type Line, type Row } from "./domain";
import { shortReference } from "./codes";
import { orderCartons, workflows, type Workflow } from "./workflow";
import { readWorkstation, saveWorkstation } from "./workstation";
import { brand } from "./brand";
import { site } from "./site";

const tallyAvailable = (master: Row) => master.inTally !== false && (site?.slug !== "electro" || !!master.tallyId);

function customerAddress(value: unknown): string {
  const address = String(value ?? "").trim();
  return /fictional address for dispatch trial|fictional dispatch trial customer/i.test(address) ? "" : address;
}

export function WorkflowChooser({ choose, user, openSettings, signOut, error }: { choose: (workflow: Workflow) => void; user: Row; openSettings: () => void; signOut: () => void; error?: string }) {
  return <main className="workflow-picker">
    <header className="workflow-picker-header"><div className="brand-mark">E</div><div><strong>{brand.name}</strong><span>Dispatch management</span></div><button className="text-link" onClick={signOut}>Sign out</button></header>
    <section className="workflow-intro"><span className="eyebrow">YOUR DISPATCH WORKSPACE</span><h1>How are we preparing this dispatch?</h1><p>Choose the workflow that matches this dispatch.</p></section>
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
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get("newOrder") === "1"), [cancelling, setCancelling] = useState<Row | null>(null), [cancelReason, setCancelReason] = useState(""), [cancelConfirmation, setCancelConfirmation] = useState(""), [cancelConfirmed, setCancelConfirmed] = useState(false), [cancellingNow, setCancellingNow] = useState(false), [removingTest, setRemovingTest] = useState<Row | null>(null), [confirmation, setConfirmation] = useState("");
  const canCreate = !ctx.sample && ctx.user.roles.some((r: string) => ["Admin", "DispatchSupervisor", "PackingSupervisor", "Billing"].includes(r));
  const canDelete = !ctx.sample && ctx.user.roles.some((r: string) => ["Admin", "DispatchSupervisor"].includes(r));
  const canRemoveTest = !ctx.sample && ctx.user.roles.includes("Admin") && ctx.workflow === "OrderFirst";
  function openNewOrder() { const url = new URL(window.location.href); url.searchParams.set("newOrder", "1"); window.history.replaceState(null, "", url.pathname + url.search + url.hash); setOpen(true); }
  function closeNewOrder() { const url = new URL(window.location.href); url.searchParams.delete("newOrder"); window.history.replaceState(null, "", url.pathname + url.search + url.hash); setOpen(false); }
  function pack(order: Row) {
    if (!ctx.selectWork({ kind: "all" })) return;
    const url = new URL(window.location.href); url.searchParams.set("order", order.id); window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    ctx.navigate("packing");
  }
  return <>
    <div className="page-heading"><div><h1>Customer orders</h1><p>{workflow === "StockFirst" ? "An order has arrived. Choose from the stock you already packed and labelled." : "Orders can be started at any time. Earlier orders stay here with their progress and history."}</p></div><button className="primary" onClick={openNewOrder} disabled={!canCreate}><Plus size={17} />New order</button></div>
    {orders.length ? <div className="record-card-grid order-card-grid">{orders.map(order => {
      const assigned = orderCartons(s, order), manifests = s.manifests.filter(m => m.orderId === order.id);
      const cancelled = order.state === "Cancelled";
      const packed = s.orderProgress?.find(row => row.orderId === order.id)?.packedCartons ?? s.cartons.filter(c => manifests.some(m => m.id === c.manifestId) && c.state !== "Retired").length;
      function continueOrder() { const url = new URL(window.location.href); url.searchParams.set("order", order.id); window.history.replaceState(null, "", url.pathname + url.search + url.hash); ctx.navigate("overview"); }
      return <section className="panel order-card" key={order.id}>
        <div className="work-card-top"><span className="work-card-kind">Customer order</span><Badge tone={cancelled ? "amber" : assigned >= order.expectedCartons ? "sage" : "amber"}>{cancelled ? "Cancelled · history kept" : assigned >= order.expectedCartons ? "Boxes assigned" : "Open"}</Badge></div>
        <h2>{order.reference}</h2><strong>{s.customers.find(c => c.id === order.customerId)?.name ?? order.customerId}</strong><p>{order.destination}</p><small title={order.id}>{shortReference(order.id)}</small>
        <div className="work-card-facts"><div><span>Expected boxes</span><strong>{number(order.expectedCartons)}</strong></div><div><span>Assigned to trips</span><strong>{number(assigned)}</strong></div>{workflow === "OrderFirst" && <div><span>Packed so far</span><strong>{number(packed)}</strong></div>}</div>
        <details className="order-contents"><summary>Order details</summary>{parse<Line[]>(order.lines).length ? parse<Line[]>(order.lines).map((line, i) => <p key={i}>{line.sku}: {line.quantity} {line.unit}</p>) : <p>Box count only. Review the product mix before billing.</p>}{order.notes && <p>{order.notes}</p>}</details>
        {!cancelled && <div className="button-row">{workflow === "OrderFirst" && <button className="primary" disabled={!canCreate || packed >= order.expectedCartons} onClick={() => pack(order)}>{manifests.some(m => m.state === "Draft") ? "Edit box plan" : "Review box plan"} <ArrowRight size={16} /></button>}<button className="secondary" onClick={() => workflow === "OrderFirst" ? continueOrder() : (ctx.selectWork({ kind: "all" }) && ctx.navigate("trips"))}>{workflow === "OrderFirst" ? "Continue order" : "Prepare shipment"}</button></div>}
        {canDelete && !cancelled && <button className="text-link danger" onClick={() => { setCancelling(order); setCancelReason(""); setCancelConfirmation(""); setCancelConfirmed(false); }}><Trash2 size={14} />Cancel order / PO</button>}
        {canRemoveTest && order.reference === "PO-1234-TEST" && s.customers.find(c => c.id === order.customerId)?.name === "TEST - Bengaluru Machine Works" && <button className="text-link danger" onClick={() => { setRemovingTest(order); setConfirmation(""); }}><Trash2 size={14} />Remove test order and trial records</button>}
      </section>;
    })}</div> : <section className="panel"><Empty title="No customer orders yet" detail={workflow === "OrderFirst" ? "Add the first order, then pack its boxes." : "Your packed stock can stay ready here until an order arrives."} /></section>}
    {open && <OrderEditor ctx={ctx} close={closeNewOrder} />}
    {cancelling && <Modal title="Cancel customer order / PO" close={() => { if (!cancellingNow) setCancelling(null); }}><p><strong>{cancelling.reference}</strong> will be removed from active work. The order, box scans, shipment and billing history will stay in Past Orders.</p><p>If boxes are already loaded, physically unload and release them after cancellation. Any invoice already sent or confirmed in Tally remains in Tally and must be handled there by your accountant.</p><form onSubmit={async e => { e.preventDefault(); if (cancellingNow) return; setCancellingNow(true); try { await ctx.run("cancelOrder", { id: cancelling.id, reason: cancelReason, confirmation: cancelConfirmation, confirmed: cancelConfirmed, workflow }); setCancelling(null); setCancelReason(""); setCancelConfirmation(""); setCancelConfirmed(false); } catch { /* The app displays the server error. */ } finally { setCancellingNow(false); } }}><Field label="Reason for cancellation"><textarea required minLength={3} maxLength={1000} value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="For example: customer cancelled the purchase order" /></Field><Field label={`Type ${cancelling.reference} to confirm`}><input required value={cancelConfirmation} onChange={e => setCancelConfirmation(e.target.value)} /></Field><label className="check-field"><input type="checkbox" required checked={cancelConfirmed} onChange={e => setCancelConfirmed(e.target.checked)} />I understand the order history is retained and any existing Tally invoice is not deleted.</label><button className="primary destructive" disabled={cancellingNow || cancelReason.trim().length < 3 || cancelConfirmation !== cancelling.reference || !cancelConfirmed}>{cancellingNow ? "Cancelling…" : "Cancel order and keep history"}</button></form></Modal>}
    {removingTest && <Modal title="Remove test order" close={() => { setRemovingTest(null); setConfirmation(""); }}><p>This removes <strong>PO-1234-TEST</strong> and its undeparated test-only packing, label, shipment, scan, and billing records from Dispatch. Other orders and their history stay. The separate Tally voucher and customer ledger are left untouched.</p><form onSubmit={async e => { e.preventDefault(); try { await ctx.run("deleteDemoOrder", { id: removingTest.id, confirmation, reason: "Administrator requested removal of the Electro test order and its Dispatch trial records.", workflow }); setRemovingTest(null); setConfirmation(""); } catch { /* The app displays the server error. */ } }}><Field label="Type PO-1234-TEST to confirm"><input required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></Field><button className="primary destructive" disabled={confirmation !== "PO-1234-TEST"}>Remove test order</button></form></Modal>}
  </>;
}

export function OrderPicker({ ctx, value, onChange, disabled = false, required = false }: { ctx: Context; value: string; onChange: (value: string) => void; disabled?: boolean; required?: boolean }) {
  return <Field label="Customer order"><select aria-label="Customer order" value={value} required={required} disabled={disabled} onChange={e => onChange(e.target.value)}>
    <option value="">{required ? "Choose the received order" : "Choose an order (optional)"}</option>
    {(ctx.all.orders ?? []).filter(o => o.state !== "Cancelled" && (o.state === "Open" || o.id === value)).map(order => <option key={order.id} value={order.id}>{order.reference} · {ctx.all.customers.find(c => c.id === order.customerId)?.name} · {order.expectedCartons} boxes</option>)}
  </select></Field>;
}

export function SharedMasters({ ctx }: { ctx: Context }) {
  const [kind, setKind] = useState<"product" | "customer" | null>(null), [name, setName] = useState(""), [sku, setSku] = useState(""), [unit, setUnit] = useState("Nos"), [address, setAddress] = useState(""), [nativeId, setNative] = useState(""), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const canManage = !ctx.sample && ctx.user.roles.some((role: string) => ["Admin", "Billing"].includes(role));
  const tallyAuthoritative = site?.slug === "electro";
  const activeProducts = ctx.all.products.filter(tallyAvailable);
  const activeCustomers = ctx.all.customers.filter(tallyAvailable);
  function open(value: "product" | "customer") { setKind(value); setName(""); setSku(""); setUnit("Nos"); setAddress(""); setNative(""); setError(""); }
  return <section className="panel panel-padding shared-masters"><div className="panel-heading"><div><h2>Customers & products</h2><p>{tallyAuthoritative ? "Tally is the source for Electro customers and products. Updates sync automatically; removed Tally masters stop appearing in new work while old records stay available." : "Names and item details follow the latest Tally sync. Masters removed in Tally are retained here for old order records and marked as no longer in Tally."}</p></div>{!tallyAuthoritative && <div className="button-row"><button className="secondary small" disabled={!canManage} onClick={() => open("product")}><Plus size={15} />Add product</button><button className="secondary small" disabled={!canManage} onClick={() => open("customer")}><Plus size={15} />Add customer</button></div>}</div>
    <div className="form-grid"><details><summary>Products ({activeProducts.length} in Tally · {ctx.all.products.length - activeProducts.length} unavailable)</summary>{ctx.all.products.length ? ctx.all.products.map(p => <p key={p.id}><strong>{p.sku}</strong> · {p.name} · {p.unit}{p.inTally === false || (tallyAuthoritative && !p.tallyId) ? " · Not available in Tally (history kept)" : ""}{p.tallyGroup ? ` · Tally group ${p.tallyGroup}` : ""}{p.hsnCode ? ` · HSN ${p.hsnCode}` : ""}{p.gstRate != null ? ` · GST ${p.gstRate}%` : " · GST needs review"}{p.bookBalance != null ? ` · Tally balance ${p.bookBalance}` : ""}</p>) : <p>No products yet.</p>}</details><details><summary>Customers ({activeCustomers.length} in Tally · {ctx.all.customers.length - activeCustomers.length} unavailable)</summary>{ctx.all.customers.length ? ctx.all.customers.map(c => <p key={c.id}><strong>{c.name}</strong>{c.inTally === false || (tallyAuthoritative && !c.tallyId) ? " · Not available in Tally (history kept)" : ""}{c.gstIn ? ` · GSTIN ${c.gstIn}` : " · GSTIN not available"}{c.tallyAddress ? <><br />Tally address: {c.tallyAddress}</> : null}{c.address ? <><br />Dispatch address: {c.address}</> : null}</p>) : <p>No customers yet.</p>}</details></div>
    {kind && <Modal title={kind === "product" ? "Add product" : "Add customer"} close={() => { if (!saving) setKind(null); }}><form onSubmit={async e => {
      e.preventDefault(); if (saving) return; setSaving(true); setError("");
      try { await ctx.run(kind === "product" ? "saveProduct" : "saveCustomer", kind === "product" ? { name, sku, unit, tallyId: nativeId, tallyName: name, reason: "Company product setup" } : { name, address, tallyId: nativeId, reason: "Company customer setup" }); setKind(null); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
    }}><Field label={kind === "product" ? "Product name" : "Customer name"}><input required minLength={2} value={name} onChange={e => setName(e.target.value)} /></Field>{kind === "product" ? <><Field label="Exact item code / SKU"><input required maxLength={50} value={sku} onChange={e => setSku(e.target.value)} /></Field><Field label="Base unit"><input required value={unit} onChange={e => setUnit(e.target.value)} /></Field></> : <Field label="Customer address"><textarea required minLength={3} value={address} onChange={e => setAddress(e.target.value)} /></Field>}<Field label="Tally master ID (optional until integration)"><input value={nativeId} onChange={e => setNative(e.target.value)} /></Field><p className="muted">This saves this company’s dispatch record. It does not create a master in Tally.</p>{error && <p className="notice error" role="alert">{error}</p>}<button className="primary wide" disabled={saving}>{saving ? "Saving…" : "Save for this company"}</button></form></Modal>}
  </section>;
}

function OrderEditor({ ctx, close }: { ctx: Context; close: () => void }) {
  const orderFirst = ctx.workflow === "OrderFirst";
  const availableCustomers = ctx.all.customers.filter(tallyAvailable);
  const products = ctx.all.products.filter(tallyAvailable);
  const [reference, setReference] = useState(""), [customerId, setCustomer] = useState(availableCustomers[0]?.id ?? ""), [destination, setDestination] = useState(customerAddress(availableCustomers[0]?.tallyAddress) || customerAddress(availableCustomers[0]?.address)), [notes, setNotes] = useState(""), [groups, setGroups] = useState<Group[]>([{ marking: "BOX-GROUP-1", count: 1, lines: [{ sku: products[0]?.sku ?? "", quantity: "1", unit: products[0]?.unit ?? "" }] }]), [expectedBoxes, setExpectedBoxes] = useState("1"), [orderLines, setOrderLines] = useState<Line[]>([]), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const totalBoxes = groups.reduce((total, group) => total + Number(group.count || 0), 0);
  function updateGroup(index: number, update: (group: Group) => Group) { setGroups(previous => previous.map((group, i) => i === index ? update(group) : group)); }
  return <Modal title="New customer order" close={() => { if (!saving) close(); }}><form onSubmit={async e => {
    e.preventDefault(); if (saving) return; setSaving(true); setError("");
    try {
      const boxCount = orderFirst ? totalBoxes : Number(expectedBoxes);
      if (boxCount < 1 || boxCount > 10000) throw new Error("Enter a total of 1 to 10,000 boxes.");
      const boxGroups = groups.map((group, index) => ({ ...group, marking: `BOX-GROUP-${index + 1}`, count: Number(group.count), lines: group.lines.map(line => ({ ...line, quantity: Number(line.quantity) })) }));
      const created = await ctx.run("createOrder", { reference, customerId, destination, expectedCartons: boxCount, warehouseId: ctx.all.warehouses[0]?.id, lines: orderFirst ? [] : orderLines, ...(orderFirst ? { boxGroups } : {}), notes });
      if (ctx.workflow === "OrderFirst" && created?.id) { const url = new URL(window.location.href); url.searchParams.set("order", created.id); url.searchParams.delete("newOrder"); window.history.replaceState(null, "", url.pathname + url.search + url.hash); }
      const labelsReady = orderFirst && !!created?.manifestId && ctx.selectWork({ kind: "packing", id: created.manifestId });
      close();
      if (labelsReady) ctx.navigate("printLabels");
      else if (orderFirst) ctx.navigate("overview");
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }}>
    {!availableCustomers.length && <p className="notice amber">No customer is present in the latest Tally sync. Refresh Tally masters or add the customer ledger in Tally first.</p>}
    <Field label="Order / purchase order reference"><input required minLength={2} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} placeholder="PO-1024" /></Field>
    <Field label="Customer"><select required value={customerId} onChange={e => { const id = e.target.value; setCustomer(id); const selected = ctx.all.customers.find(c => c.id === id); setDestination(customerAddress(selected?.tallyAddress) || customerAddress(selected?.address)); }}>{availableCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    <Field label="Delivery destination"><input required minLength={3} maxLength={300} value={destination} onChange={e => setDestination(e.target.value)} placeholder="Enter the customer’s confirmed delivery address" />{customerAddress(ctx.all.customers.find(c => c.id === customerId)?.tallyAddress) ? <small>Filled from this customer’s synced Tally address, including state. Edit only if this order ships to a different site.</small> : /fictional address for dispatch trial|fictional dispatch trial customer/i.test(String(ctx.all.customers.find(c => c.id === customerId)?.tallyAddress ?? "")) ? <small className="notice error">Tally has a trial placeholder for this customer, not a real delivery address. Enter the address confirmed by the customer before saving.</small> : customerAddress(ctx.all.customers.find(c => c.id === customerId)?.address) ? <small>No usable Tally address is synced. This is the saved Dispatch address; verify it before use.</small> : <small>No real address is available for this customer yet. Enter the customer-confirmed delivery address before saving.</small>}</Field>
    {!orderFirst && <Field label="Number of boxes ordered"><input required type="number" min={1} max={10000} value={expectedBoxes} onChange={e => setExpectedBoxes(e.target.value)} /></Field>}
    {orderFirst && <section className="order-requirements"><div className="work-card-top"><strong>Box count and contents</strong><Badge tone="sage">{totalBoxes} {totalBoxes === 1 ? "box" : "boxes"}</Badge></div><p>Set how many boxes have each product mix. Add products to a group for mixed contents in the same box. Boxes in one group share the same contents.</p>
      {!products.length && <p className="notice amber">No products are available from the latest Tally sync. Refresh the Tally masters before creating this order.</p>}
      {groups.map((group, i) => <section className="group-editor" key={i}><strong>Box group {i + 1}</strong><Field label="Number of boxes with this mix"><input required type="number" min={1} max={10000} value={group.count} onChange={e => updateGroup(i, current => ({ ...current, count: Number(e.target.value) }))} /></Field>
        {group.lines.map((line, j) => <div className="content-line" key={j}><select aria-label={`Product in box group ${i + 1}`} required value={line.sku} onChange={e => { const product = products.find(p => p.sku === e.target.value); updateGroup(i, current => ({ ...current, lines: current.lines.map((item, k) => k === j ? { ...item, sku: e.target.value, unit: product?.unit ?? "" } : item) })); }}><option value="">Choose product</option>{products.filter(p => p.sku === line.sku || !group.lines.some((item, k) => k !== j && item.sku === p.sku)).map(p => <option key={p.id} value={p.sku}>{p.name} · {p.sku}</option>)}</select><input aria-label="Quantity per box" required type="number" min="0.000001" step="any" inputMode="decimal" value={line.quantity} onChange={e => updateGroup(i, current => ({ ...current, lines: current.lines.map((item, k) => k === j ? { ...item, quantity: e.target.value } : item) }))} /><span>{line.unit} / box</span>{group.lines.length > 1 && <button type="button" className="text-link danger" onClick={() => updateGroup(i, current => ({ ...current, lines: current.lines.filter((_, k) => k !== j) }))}>Remove</button>}</div>)}
        <div className="button-row"><button type="button" className="text-link" disabled={!products.length} onClick={() => updateGroup(i, current => ({ ...current, lines: [...current.lines, { sku: products[0].sku, quantity: "1", unit: products[0].unit }] }))}>+ Add another product to this box</button>{groups.length > 1 && <button type="button" className="text-link danger" onClick={() => setGroups(previous => previous.filter((_, j) => j !== i))}>Remove box group</button>}</div>
      </section>)}
      <button type="button" className="secondary small" disabled={!products.length || totalBoxes >= 10000} onClick={() => setGroups(previous => [...previous, { marking: `BOX-GROUP-${previous.length + 1}`, count: 1, lines: [{ sku: products[0].sku, quantity: "1", unit: products[0].unit }] }])}>+ Add a different box mix</button>
    </section>}
    {!orderFirst && <details className="order-requirements"><summary>Order product totals (optional)</summary><p>Enter the total quantity of each product ordered. These quantities will be checked against the boxes assigned to this order.</p>
      {orderLines.map((line, i) => <div className="content-line" key={i}><select aria-label="Required product" value={line.sku} onChange={e => setOrderLines(previous => previous.map((item, j) => j === i ? { ...item, sku: e.target.value, unit: products.find(p => p.sku === e.target.value)?.unit ?? "" } : item))}><option value="">Choose product</option>{products.map(p => <option key={p.id} value={p.sku}>{p.sku} · {p.name}</option>)}</select><input aria-label="Required product quantity" required inputMode="decimal" value={line.quantity} onChange={e => setOrderLines(previous => previous.map((item, j) => j === i ? { ...item, quantity: e.target.value } : item))} /><span>{line.unit}</span><button type="button" className="text-link danger" aria-label="Remove product requirement" onClick={() => setOrderLines(previous => previous.filter((_, j) => j !== i))}><Trash2 size={15} /></button></div>)}
      <button type="button" className="secondary small" disabled={!products.length} onClick={() => setOrderLines(previous => [...previous, { sku: products[0]?.sku ?? "", quantity: "1", unit: products[0]?.unit ?? "" }])}>Add product requirement</button>
    </details>}
    <Field label="Order notes"><textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    {error && <p className="notice error" role="alert">{error}</p>}<button className="primary wide" disabled={saving || !customerId}>{saving ? "Saving order…" : "Save order"}</button>
  </form></Modal>;
}

export function WorkstationSettings({ ctx }: { ctx: Context }) {
  const company = ctx.all.company.id ?? "demo";
  const [station, setStation] = useState(() => readWorkstation(company).station), [message, setMessage] = useState("");
  return <section className="panel panel-padding shared-devices"><h2>Scanner & printers on this computer</h2><p>Use the same physical scanner and printer on either company website. Select the scan box here to send scans to this company; choose the printer in the browser print dialog.</p>
    <form onSubmit={e => { e.preventDefault(); try { saveWorkstation(company, station); setMessage("Workstation saved for this company on this computer."); } catch (e) { setMessage((e as Error).message); } }}><Field label="Scanner workstation name"><input minLength={2} maxLength={80} required value={station} onChange={e => setStation(e.target.value)} disabled={ctx.sample} /></Field><button className="secondary" disabled={ctx.sample}>Save workstation</button></form>
    {message && <p role="status">{message}</p>}<div className="shared-device-facts"><span><ScanLine size={17} />One scan per box, in Labels</span><span><Printer size={17} />Same A4 label and document printing</span></div><p className="muted">Use a different workstation name on each computer. Each company keeps its own Tally pairing and workstation settings. Open the correct company site before scanning.</p>
  </section>;
}
