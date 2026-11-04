import { api, state as loadWorkState } from "./api";
import { plainLabel } from "./brand";
import { site } from "./site";
import { useState, useEffect, type FormEvent } from "react";
import {
  Plus,
  Check,
  Printer,
  FileDown,
  Upload,
  ArrowUpRight,
  Search,
  ShieldCheck,
  Truck,
  ScanLine,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge, Empty, Field, Modal, type Context } from "./main";
import {
  type Row,
  type Group,
  type Line,
  type State,
  parse,
  number,
  money,
  date,
  totals,
  csvRows,
  importGroups,
  safeCsv,
  parseQr,
} from "./domain";
import { labelPdf, packingPdf, download, invoicePdf } from "./labels";
import { GroupedRecords, ShipmentChoices, WorkCardSummary } from "./work-ui";
import { cartonQr, shortReference } from "./codes";
import { shipmentName } from "./work";
import { DispatchScanScreen, hasPendingScan } from "./scanner";
import { OrderPicker, WorkstationSettings, SharedMasters } from "./workflow-ui";
import { orderCartons } from "./workflow";
const tallyMasterAvailable = (master: Row) => master.inTally !== false && (site?.slug !== "electro" || !!master.tallyId);
export function Heading({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>
          {title}
          <span className="heading-dot">.</span>
        </h1>
        <p>{detail}</p>
      </div>
      {action}
    </div>
  );
}
const may = (ctx: Context, ...roles: string[]) =>
  !ctx.sample &&
  (ctx.user.roles.includes("Admin") ||
    roles.some((r) => ctx.user.roles.includes(r)));
const action = (ctx: Context, type: string, data: Row) =>
  ctx.run(type, data).catch(() => null);
const groupTotal = (g: Group[]) => g.reduce((n, x) => n + x.count, 0);
function DeleteWorkButton({ ctx, kind, record }: { ctx: Context; kind: "packing" | "trip" | "shipment"; record: Row }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState(""), [checked, setChecked] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const label = kind === "packing" ? "packing list" : kind === "trip" ? "vehicle trip" : "shipment";
  const permitted = may(ctx, kind === "packing" ? "PackingSupervisor" : "DispatchSupervisor");
  return <>
    <button className="text-link danger delete-work" disabled={!permitted || hasPendingScan()} title={hasPendingScan() ? "Resolve the pending scan before deleting work." : undefined} onClick={() => { setOpen(true); setReason(""); setChecked(false); setError(""); }}><Trash2 size={15} />Delete {label}</button>
    {open && <Modal title={"Delete " + label} close={() => { if (!saving) setOpen(false); }}>
      <p><strong>{record.name || record.vehicle || shipmentName(ctx.all, record.id)}</strong></p>
      <p>{kind === "packing" ? "This removes the unused packing list and its boxes. Destroy any printed labels for these boxes." : kind === "trip" ? "Only an empty trip that has not departed can be deleted." : "Reserved boxes become available again. Loaded, approved or invoiced shipments must be resolved before deletion."} A deletion record is kept in history.</p>
      <form onSubmit={async e => { e.preventDefault(); if (!checked || saving) return; setSaving(true); setError(""); try { await ctx.run(kind === "packing" ? "deleteManifest" : kind === "trip" ? "deleteTrip" : "deleteShipment", {id:record.id,reason,confirmed:true,...(kind === "packing" ? {version:record.version} : {})}); setOpen(false); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } }}>
        <Field label="Reason for deleting"><input value={reason} onChange={e=>setReason(e.target.value)} minLength={3} required disabled={saving} /></Field>
        <label className="check-field"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} disabled={saving} />I understand this removes the {label} from active work.</label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="button-row"><button type="button" className="secondary" disabled={saving} onClick={()=>setOpen(false)}>Keep {label}</button><button className="primary destructive" disabled={!checked || reason.trim().length < 3 || saving}>{saving ? "Deleting…" : "Delete " + label}</button></div>
      </form>
    </Modal>}
  </>;
}
export function PackingScreen(ctx: Context) {
  const { s } = ctx;
  const [edit, setEdit] = useState<Row | null>(() => {
      const id = new URLSearchParams(window.location.search).get("order");
      const order = ctx.workflow === "OrderFirst" ? ctx.all.orders?.find(o => o.id === id) : null;
      const draft = order ? s.manifests.find(item => item.orderId === order.id && item.state === "Draft") : null;
      return draft ?? (order ? { orderId: order.id, customerId: order.customerId, warehouseId: order.warehouseId, name: "Packing " + order.reference } : null);
    }),
    [importing, setImporting] = useState(false),
    [confirm, setConfirm] = useState<Row | null>(null),
    [checked, setChecked] = useState(false);
  const canPack = ctx.all.products.length > 0 && (ctx.workflow !== "OrderFirst" || !!ctx.all.orders?.length);
  const guidedOrder = ctx.workflow === "OrderFirst" && !!new URLSearchParams(window.location.search).get("order");
  function closeEditor(preserveOrder = false) {
    setEdit(null);
    if (!preserveOrder) {
      const url = new URL(window.location.href);
      url.searchParams.delete("order");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }
  return (
    <>
      {!guidedOrder && <Heading
        eyebrow={ctx.workflow === "OrderFirst" ? "PACKING FOR A CUSTOMER ORDER" : "MANUFACTURED. ORDER PENDING."}
        title="Packing"
        detail={ctx.workflow === "OrderFirst" ? "Choose the received order, then record its packed boxes." : "Record packed stock and print labels now. Assign a customer after an order arrives."}
        action={
          <div className="button-row">
            <button
              className="secondary"
              disabled={!canPack || !may(ctx, "PackingClerk", "PackingSupervisor")}
              onClick={() => setImporting(true)}
            >
              <Upload size={16} />
              Import CSV / Excel
            </button>
            <button
              className="primary"
              disabled={!canPack || !may(ctx, "PackingClerk", "PackingSupervisor")}
              onClick={() => setEdit({})}
            >
              <Plus size={17} />
              New packing list
            </button>
          </div>
        }
      />}
      {!guidedOrder && ctx.workflow === "OrderFirst" && !ctx.all.orders?.length && <div className="notice amber"><span>Record a customer order before packing.</span><button className="secondary small" onClick={() => ctx.navigate("orders")}>Open orders</button></div>}
      {!guidedOrder && !ctx.all.products.length && <div className="notice amber"><span>Add your products before registering packed boxes.</span><button className="secondary small" onClick={() => ctx.navigate("setup")}>Shared settings</button></div>}
      {!guidedOrder && <section className="panel">
        {s.manifests.length ? (
          <div className="table-wrap">
            <GroupedRecords ctx={ctx} rows={s.manifests} type="packing">{(records) => (<table>
              <thead>
                <tr>
                  <th>PACKING LIST</th>
                  <th>CONTENTS</th>
                  <th>BOXES</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {records.map((m) => {
                  const groups = parse<Group[]>(m.groups);
                  return (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.name}</strong>
                        <small>
                          {shortReference(m.id)} · Version {m.version}
                        </small>
                      </td>
                      <td>
                        {[
                          ...new Set(
                            groups.flatMap((g) => g.lines.map((l) => l.sku)),
                          ),
                        ].join(", ")}
                        <small>{groups.length} physical groups</small>
                      </td>
                      <td>{groupTotal(groups)}</td>
                      <td>
                        <Badge tone={m.state === "Approved" ? "sage" : "amber"}>
                          {m.state}
                        </Badge>
                      </td>
                      <td>
                        <div className="button-row">
                          <button
                            className="small secondary"
                            onClick={() => setEdit(m)}
                          >
                            {m.state === "Draft"
                              ? "Review / edit"
                              : "View contents"}
                          </button>
                          {m.state === "Draft" && (
                            <button
                              className="small primary"
                              disabled={!may(ctx, "PackingSupervisor")}
                              onClick={() => {
                                setConfirm(m);
                                setChecked(false);
                              }}
                            >
                              Approve
                            </button>
                          )}
                          <DeleteWorkButton ctx={ctx} kind="packing" record={m} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>)}</GroupedRecords>
          </div>
        ) : (
          <Empty
            title="No packing lists yet"
            detail="Add packed boxes or upload an Excel file."
          />
        )}
      </section>}
      {edit && (
        <PackedEditor ctx={ctx} manifest={edit} close={closeEditor} />
      )}
      {importing && (
        <ImportDialog ctx={ctx} close={() => setImporting(false)} />
      )}
      {confirm && (
        <Modal
          title="Check and approve packing"
          close={() => setConfirm(null)}
        >
          <p>
            Check each physical group against the recorded contents for{" "}
            <strong>{confirm.name}</strong>. Sealed contents cannot be proven by
            database data.
          </p>
          <div className="contents-preview">
            {parse<Group[]>(confirm.groups).map((g) => (
              <div key={g.marking}>
                <strong>
                  Group {g.marking} · {g.count} boxes
                </strong>
                <p>
                  {g.lines
                    .map((l) => `${l.quantity} ${l.unit} ${l.sku} per box`)
                    .join(" + ")}
                </p>
              </div>
            ))}
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I matched the physical boxes, group markings and actual contents.
          </label>
          <button
            className="primary wide"
            disabled={!checked || !may(ctx, "PackingSupervisor")}
            onClick={async () => {
              if (
                await action(ctx, "approveManifest", {
                  id: confirm.id,
                  physicalConfirmed: true,
                })
              ) {
                setConfirm(null);
                if (site?.slug === "electro" && ctx.workflow === "OrderFirst") ctx.navigate("overview");
              }
            }}
          >
            <Check size={17} />
            Approve {groupTotal(parse(confirm.groups))} boxes
          </button>
        </Modal>
      )}
    </>
  );
}
function PackedEditor({
  ctx,
  manifest: m,
  close,
}: {
  ctx: Context;
  manifest: Row;
  close: (preserveOrder?: boolean) => void;
}) {
  const orderFirst = ctx.workflow === "OrderFirst";
  const order = ctx.all.orders?.find((o) => o.id === (m.orderId ?? ""));
  const activeProducts = ctx.s.products.filter(tallyMasterAvailable);
  const cartonCount = Math.max(1, Number(order?.expectedCartons) || 1);
  const orderLines = order?.lines ? (() => { try { return parse<Line[]>(order.lines); } catch { return []; } })() : [];
  const suggestedLines = orderLines.map((line) => {
    const total = Number(line.quantity);
    const perCarton = Number.isFinite(total) && total > 0 ? total / cartonCount : 0;
    const quantity = Number.isInteger(perCarton) ? String(perCarton) : perCarton.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    return { ...line, quantity: quantity || "1", unit: ctx.s.products.find((p) => p.sku === line.sku)?.unit ?? line.unit };
  }).filter((line) => activeProducts.some((p) => p.sku === line.sku));
  const [name, setName] = useState(m.name ?? ""),
    [orderId, setOrderId] = useState(m.orderId ?? ""),
    [notes, setNotes] = useState(m.notes ?? ""),
    [groups, setGroups] = useState<Group[]>(
      m.groups
        ? parse(m.groups)
        : [
            {
              marking: "A",
              count: cartonCount,
              lines: suggestedLines.length ? suggestedLines : orderFirst ? [
                { sku: "", quantity: "", unit: "" },
              ] : [
                {
                  sku: activeProducts[0]?.sku ?? "",
                  quantity: "100",
                  unit: activeProducts[0]?.unit ?? "packets",
                },
              ],
            },
          ],
    );
  const readonly =
    m.state === "Approved" || !may(ctx, "PackingClerk", "PackingSupervisor");
  const selectedOrder = ctx.all.orders?.find(o => o.id === orderId);
  const automaticName = selectedOrder ? `Packing ${selectedOrder.reference}` : "Packing order";
  function change(i: number, key: string, value: any) {
    setGroups((p) => p.map((g, j) => (j === i ? { ...g, [key]: value } : g)));
  }
  return (
    <Modal
      title={orderFirst ? "Check the boxes" : m.id ? "Packed contents" : "New packing list"}
      close={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = {
            name: orderFirst ? automaticName : name,
            warehouseId: orderFirst ? order?.warehouseId : m.warehouseId ?? ctx.s.warehouses[0]?.id,
            customerId: orderFirst ? order?.customerId : null,
            orderId: orderFirst ? orderId : null,
            notes,
            groups,
            ...(m.id ? { id: m.id, version: m.version } : {}),
          };
          const result = await action(ctx, "saveManifest", data);
          if (result) {
            close(orderFirst);
            if (!m.id) ctx.selectWork({ kind: "packing", id: result.id });
            if (site?.slug === "electro" && orderFirst) ctx.navigate("overview");
          }
        }}
      >
        {!orderFirst && <Field label="Packing list name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={3}
            required
            disabled={readonly}
          />
        </Field>}
        {!orderFirst && <p className="notice">General stock. No customer is needed until an order arrives.</p>}
        {orderFirst && selectedOrder && <p className="order-packing-context"><strong>{ctx.all.customers.find(c => c.id === selectedOrder.customerId)?.name}</strong> · {selectedOrder.reference} · {selectedOrder.expectedCartons} boxes ordered</p>}
        {orderFirst && orderLines.length > 0 && <p className="notice">Order product totals: {orderLines.map((line, i) => <span key={i}>{i ? " · " : ""}{ctx.s.products.find(p => p.sku === line.sku)?.name ?? line.sku}: {line.quantity} {line.unit}</span>)}. The mix inside each box is up to you, but all boxes together must add up to these totals.</p>}
        {orderFirst && !m.groups && <p className="notice">{orderLines.length > 0 ? "We started with an even split. To put multiple products in one box, click Add another product to each box. Add a box group only when you need another box." : "Choose the products and quantities for each box. To put multiple products in one box, click Add another product to each box. Add a box group only when you need another box."}</p>}

        <div className="group-editors">
          {groups.map((g, i) => (
            <section className="group-editor" key={i}>
              <div className="form-grid">
                {!orderFirst && <Field label="Group mark on the boxes">
                  <input
                    value={g.marking}
                    onChange={(e) => change(i, "marking", e.target.value)}
                    required
                    disabled={readonly}
                  />
                </Field>}
                <Field label="Number of boxes">
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={g.count}
                    onChange={(e) => change(i, "count", Number(e.target.value))}
                    disabled={readonly}
                    required
                  />
                </Field>
              </div>
              {g.lines.map((l, j) => (
                <div className="content-line" key={j}>
                  <select
                    aria-label="Product SKU"
                    required
                    value={l.sku}
                    disabled={readonly}
                    onChange={(e) =>
                      change(
                        i,
                        "lines",
                        g.lines.map((x, k) =>
                          k === j
                            ? {
                                ...x,
                                sku: e.target.value,
                                unit: ctx.s.products.find(
                                  (p) => p.sku === e.target.value,
                                )?.unit,
                              }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="">Choose product</option>
                    {ctx.s.products.filter((p) => tallyMasterAvailable(p) || p.sku === l.sku).map((p) => (
                      <option value={p.sku} key={p.id}>
                        {p.sku} · {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Quantity per box"
                    type="text"
                    inputMode="decimal"
                    required
                    value={l.quantity}
                    disabled={readonly}
                    onChange={(e) =>
                      change(
                        i,
                        "lines",
                        g.lines.map((x, k) =>
                          k === j ? { ...x, quantity: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <span>{l.unit} / box</span>
                  {!readonly && g.lines.length > 1 && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() =>
                        change(
                          i,
                          "lines",
                          g.lines.filter((_, k) => k !== j),
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {!readonly && activeProducts.length > 0 && (
                <div className="button-row">
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      change(i, "lines", [
                        ...g.lines,
                        {
                          sku: activeProducts[0].sku,
                          quantity: "1",
                          unit: activeProducts[0].unit,
                        },
                      ])
                    }
                  >
                    + Add another product to each box
                  </button>
                  {groups.length > 1 && (
                    <button
                      type="button"
                      className="text-link danger"
                      onClick={() =>
                        setGroups((p) => p.filter((_, j) => i !== j))
                      }
                    >
                      Remove group
                    </button>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
        {!readonly && activeProducts.length > 0 && (
          <button
            type="button"
            className="secondary small"
            onClick={() =>
              setGroups((p) => [
                ...p,
                {
                  marking: String.fromCharCode(65 + p.length),
                  count: 1,
                  lines: [
                    {
                      sku: activeProducts[0].sku,
                      quantity: "100",
                      unit: activeProducts[0].unit,
                    },
                  ],
                },
              ])
            }
          >
            + Add box group
          </button>
        )}
        {!orderFirst && <Field label="Supervisor notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={readonly}
          />
        </Field>}
        <div className="form-summary">
          <strong>{number(groupTotal(groups))} boxes described</strong>
          <span>Contents are recorded for each box.</span>
        </div>
        {!readonly && <button className="primary wide" disabled={orderFirst && !order}>{orderFirst ? "Next: save boxes" : "Save draft"}</button>}
      </form>
    </Modal>
  );
}
function ImportDialog({ ctx, close }: { ctx: Context; close: () => void }) {
  const [preview, setPreview] = useState<{
      groups: Group[];
      errors: string[];
    } | null>(null),
    [name, setName] = useState("Imported packed stock"),
    [orderId, setOrderId] = useState(""),
    [error, setError] = useState("");
  const template =
    "group,cartons,sku,quantity,unit\nA,4,SND01,100,packets\nB,3,SND01,80,packets\nC,2,ROS01,100,packets\nD,1,SND01,40,packets\nD,1,ROS01,20,packets\n";
  async function read(file: File) {
    setError("");
    setPreview(null);
    try {
      if (file.size > 2 * 1024 * 1024)
        throw Error("Maximum upload size is 2 MB.");
      let rows: string[][];
      if (file.name.toLowerCase().endsWith(".csv"))
        rows = csvRows(await file.text());
      else if (file.name.toLowerCase().endsWith(".xlsx")) {
        const Excel = await import("exceljs");
        const workbook = new Excel.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const sheet = workbook.worksheets[0];
        if (!sheet || sheet.rowCount > 10001)
          throw Error("Workbook is empty or exceeds 10,000 data rows.");
        rows = [];
        sheet.eachRow((row) => {
          if (row.cellCount > 5)
            throw Error("Use exactly the five template columns.");
          const cells: string[] = [];
          for (let i = 1; i <= 5; i++) {
            const v = row.getCell(i).value;
            if (v && typeof v === "object")
              throw Error(
                "Formulas, rich values and links are not supported. Use plain text/number cells.",
              );
            if (row.number > 1 && i === 3 && typeof v !== "string")
              throw Error(
                `Row ${row.number}: store SKU as text to preserve leading zeros.`,
              );
            cells.push(v == null ? "" : String(v));
          }
          rows.push(cells);
        });
      } else
        throw Error(
          "Choose a .csv or .xlsx file. Macros and legacy .xls are not accepted.",
        );
      setPreview(importGroups(rows, ctx.s.products));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title="Import packing list" close={close}>
      <p>
        Use one row per group and product. Mixed boxes share the same group
        and box count. For a box with different contents, use a separate group with a box count of 1.
      </p>
      <button
        className="secondary"
        onClick={() => download("packed-group-template.csv", template)}
      >
        <FileDown size={16} />
        Download template
      </button>
      <Field label="Packing list name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {ctx.workflow === "OrderFirst" && <OrderPicker ctx={ctx} value={orderId} onChange={setOrderId} required />}
      <div className="upload-zone">
        <Upload size={25} />
        <strong>Choose a CSV or Excel workbook</strong>
        <span>Up to 2 MB or 10,000 rows. Use the item codes and units shown in this app.</span>
        <input
          aria-label="Import file"
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => {
            if (e.target.files?.[0]) void read(e.target.files[0]);
          }}
        />
      </div>
      {error && <div className="notice error">{error}</div>}
      {preview && (
        <>
          <div className="form-summary">
            <strong>
              {preview.groups.length} groups · {groupTotal(preview.groups)}{" "}
              boxes
            </strong>
            <Badge tone={preview.errors.length ? "red" : "sage"}>
              {preview.errors.length
                ? "Validation failed"
                : "Ready for draft import"}
            </Badge>
          </div>
          {preview.errors.length ? (
            <ul className="import-errors">
              {preview.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : (
            <div className="contents-preview">
              {preview.groups.map((g) => (
                <div key={g.marking}>
                  <strong>
                    {g.marking} · {g.count} boxes
                  </strong>
                  <p>
                    {g.lines
                      .map((l) => `${l.sku}: ${l.quantity} ${l.unit}`)
                      .join(" + ")}
                  </p>
                </div>
              ))}
            </div>
          )}
          <button
            className="primary wide"
            disabled={
              !!preview.errors.length ||
              (ctx.workflow === "OrderFirst" && !orderId) ||
              !may(ctx, "PackingClerk", "PackingSupervisor")
            }
            onClick={async () => {
              const result = await action(ctx, "importManifest", {
                  name,
                  warehouseId: ctx.workflow === "OrderFirst" ? ctx.all.orders?.find(o => o.id === orderId)?.warehouseId : ctx.s.warehouses[0]?.id,
                  customerId: ctx.workflow === "OrderFirst" ? ctx.all.orders?.find(o => o.id === orderId)?.customerId : null,
                  orderId: ctx.workflow === "OrderFirst" ? orderId : null,
                  notes: "Validated import. No partial import performed.",
                  groups: preview.groups,
                });
              if (result) { close(); ctx.selectWork({ kind: "packing", id: result.id }); }
            }}
          >
            Save as a draft
          </button>
        </>
      )}
    </Modal>
  );
}
export function CartonScreen(ctx: Context) {
  const guided = ctx.workflow === "OrderFirst";
  const [task, setTask] = useState(() => hasPendingScan() || new URLSearchParams(window.location.search).get("labels") === "scan" || window.location.hash === "#loading" ? "scan" : "print");
  const [taskError, setTaskError] = useState("");
  function chooseTask(next: string) {
    if (next === task) return;
    if (hasPendingScan()) { setTaskError("Check the last scan result before switching label tasks."); return; }
    const url = new URL(window.location.href);
    if (next === "scan") url.searchParams.set("labels", "scan");
    else url.searchParams.delete("labels");
    window.history.replaceState(null, "", url.pathname + url.search + "#cartons");
    setTask(next);
    setTaskError("");
  }
  return <>
    {!guided && <nav className="label-tasks" aria-label="Label tasks">
      <button aria-pressed={task === "print"} onClick={() => chooseTask("print")}><Printer size={16} />Print & attach labels</button>
      <button aria-pressed={task === "scan"} onClick={() => chooseTask("scan")}><ScanLine size={16} />Scan for dispatch</button>
    </nav>}
    {taskError && <div className="notice error" role="alert">{taskError}</div>}
    {task === "scan" ? <DispatchScanScreen {...ctx} /> : <PrintLabelsScreen {...ctx} />}
  </>;
}
function PrintLabelsScreen(ctx: Context) {
  const { s } = ctx;
  const selectedPackingId = ctx.work.kind === "packing" ? ctx.work.id : "";
  const [selected, setSelected] = useState<string[]>(() => ctx.workflow === "OrderFirst" && selectedPackingId ? s.cartons.filter(c => c.manifestId === selectedPackingId && !c.verified && !c.held && c.state !== "Retired").map(c => c.id) : []),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Row | null>(null);
  const rows = s.cartons.filter((c) =>
    (c.id + " " + shortReference(c.id) + " " + cartonQr(c as { id: string; companyId: string; revision: number }) + " " + c.marking + " " + c.state)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const chosen = s.cartons.filter((c) => selected.includes(c.id));
  async function print(test = false) {
    try {
      setError("");
      if (test) {
        await labelPdf(
          chosen.length ? chosen : rows.slice(0, 1),
          s.company.name,
          true,
        );
        return;
      }
      const r = await ctx.run("createLabels", {
        ids: selected,
        reason: "Operator requested A4 labels / unchanged revision",
      });
      await labelPdf(r.cartons, s.company.name);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Heading
        eyebrow={ctx.workflow === "OrderFirst" ? "STEP 2 OF 4" : "ONE PHYSICAL BOX. ONE UNIQUE ID."}
        title={ctx.workflow === "OrderFirst" ? "Box labels" : "Labels"}
        detail={ctx.workflow === "OrderFirst" ? "The order’s boxes are selected. Print the labels, attach them, then confirm the check." : "Print and attach labels. A supervisor confirms the labels and contents without scanning."}
        action={
          <div className="button-row">
            {ctx.workflow !== "OrderFirst" && <button
              className="secondary"
              disabled={!rows.length}
              onClick={() => print(true)}
            >
              A4 printer check
            </button>}
            <button
              className="primary"
              disabled={
                !chosen.length || !may(ctx, "PackingClerk", "PackingSupervisor")
              }
              onClick={() => print()}
            >
              <Printer size={17} />
              Print selected ({chosen.length})
            </button>
          </div>
        }
      />
      <details className="inline-help"><summary>Printer setup & label size</summary><p>Label size: 90 × 50 mm, 34 mm QR, 2 columns × 5 rows. Print at 100% / actual size. Check one label before the full batch.</p></details>
      {error && <div className="notice error">{error}</div>}
      {ctx.work.kind === "all" && s.cartons.length < s.cartonTotal && <div className="notice amber">Choose a packing list or shipment above to load its box details. The all-work list shows the first page.</div>}
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search box, group or status"
            />
          </div>
          <span>
            {rows.length} of {ctx.work.kind === "all" ? s.cartonTotal : ctx.all.workCartonTotal ?? s.cartonTotal} boxes shown
          </span>
          <button
            className="secondary small"
            disabled={
              !chosen.length || !may(ctx, "PackingSupervisor")
            }
            onClick={async () => {
              if (
                confirm(
                  "I printed each label and attached it to the matching box, confirming the label matches the box contents. No scan is needed for this step.",
                )
              ) {
                const result = await action(ctx, "attachLabels", {
                  ids: selected,
                  physicalConfirmed: true,
                  contentsConfirmed: true,
                  revisions: chosen.map((c) => ({ id: c.id, revision: c.revision })),
                });
                if (result && site?.slug === "electro" && ctx.workflow === "OrderFirst") ctx.navigate("overview");
              }
            }}
          >
            Confirm labels & contents
          </button>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <GroupedRecords ctx={ctx} rows={rows} type="carton" expand={!!search.trim()}>{(records, group) => (<table>
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label={"Select shown boxes in " + group.title}
                      type="checkbox"
                      checked={
                        records.length > 0 &&
                        records.every((c) => selected.includes(c.id))
                      }
                      onChange={(e) =>
                        setSelected((previous) => e.target.checked ? [...new Set([...previous, ...records.map((c) => c.id)])] : previous.filter((id) => !records.some((c) => c.id === id)))
                      }
                    />
                  </th>
                  <th>BOX / GROUP</th>
                  <th>CONTENTS PER BOX</th>
                  <th>PHYSICAL CHECK</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {records.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        aria-label={"Select " + c.id}
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={(e) =>
                          setSelected((p) =>
                            e.target.checked
                              ? [...p, c.id]
                              : p.filter((x) => x !== c.id),
                          )
                        }
                      />
                    </td>
                    <td>
                        <strong className="mono" title={c.id}>{shortReference(c.id)}</strong>
                      <small>
                        Group {c.marking} · Label version {c.revision}
                      </small>
                    </td>
                    <td>
                      {parse<Line[]>(c.lines).map((l, i) => (
                        <div key={i}>
                          {l.sku} · {number(l.quantity)} {l.unit}
                        </div>
                      ))}
                    </td>
                    <td>
                      <Badge
                        tone={
                          c.verified ? "sage" : c.attached ? "amber" : "neutral"
                        }
                      >
                        {c.verified
                          ? "Checked"
                          : c.attached
                            ? "Needs supervisor check"
                            : "Not attached"}
                      </Badge>
                    </td>
                    <td>
                      <Badge
                        tone={
                          c.held
                            ? "red"
                            : c.state === "Available"
                              ? "sage"
                              : "neutral"
                        }
                      >
                        {c.held ? "Held" : c.state}
                      </Badge>
                    </td>
                    <td>
                      <div className="button-row">
                        <button
                          className="text-link"
                          onClick={() => setHistory(c)}
                        >
                          Details
                        </button>
                        {may(ctx, "PackingSupervisor", "DispatchSupervisor") &&
                          c.state === "Available" && (
                            <button
                              className="text-link"
                              onClick={() => {
                                const reason = prompt(
                                  "Reason for " +
                                    (c.held
                                      ? "clearing hold"
                                      : "holding this box"),
                                );
                                if (reason)
                                  void action(ctx, "holdCarton", {
                                    id: c.id,
                                    held: !c.held,
                                    reason,
                                  });
                              }}
                            >
                              {c.held ? "Clear hold" : "Hold"}
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>)}</GroupedRecords>
          </div>
        ) : (
          <Empty
            title="No boxes yet"
            detail="Approve a packing list to create box IDs."
          />
        )}
      </section>
      {s.labels.length > 0 && (
        <details className="panel supporting-panel" open={s.labels.some((j) => j.state !== "OperatorConfirmed")}>
          <summary>Label print jobs <span>{s.labels.length}</span></summary>
          <GroupedRecords ctx={ctx} rows={s.labels} type="label">{(records) => (<table>
            <thead>
              <tr>
                <th>JOB</th>
                <th>PREPARED</th>
                <th>STATUS</th>
                <th>RECORD PHYSICAL PRINT RESULT</th>
              </tr>
            </thead>
            <tbody>
              {records.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.id.slice(0, 15)}</td>
                  <td>{date(j.createdAt)}</td>
                  <td>
                    <Badge>{j.state}</Badge>
                  </td>
                  <td>
                    <div className="button-row">
                      {[
                        "Submitted",
                        "Failed",
                        "Unknown",
                        "OperatorConfirmed",
                      ].map((status) => (
                        <button
                          key={status}
                          className="text-link"
                          disabled={
                            !may(ctx, "PackingClerk", "PackingSupervisor")
                          }
                          onClick={() =>
                            action(ctx, "labelStatus", {
                              id: j.id,
                              state: status,
                              reason: "Operator print-status report",
                            })
                          }
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>)}</GroupedRecords>
        </details>
      )}
      {history && (
        <Modal
          title="Box details"
          close={() => setHistory(null)}
        >
          <h3>{shortReference(history.id)}</h3>
          <details className="inline-help"><summary>Full box reference</summary><code>{history.id}</code></details>
          <p>Packing list: {ctx.all.manifests.find((m) => m.id === history.manifestId)?.name ?? history.manifestId}</p>
          <dl className="carton-facts">
            <div><dt>Group</dt><dd>{history.marking}</dd></div>
            <div><dt>Status</dt><dd>{plainLabel(history.state)}</dd></div>
            <div><dt>Label version</dt><dd>{history.revision}</dd></div>
            <div><dt>Label attached</dt><dd>{history.attached ? "Yes" : "No"}</dd></div>
            <div><dt>Contents checked</dt><dd>{history.verified ? "Yes" : "No"}</dd></div>
            <div><dt>On hold</dt><dd>{history.held ? "Yes" : "No"}</dd></div>
          </dl>
          <table><thead><tr><th>ITEM</th><th>QUANTITY</th></tr></thead><tbody>{parse<Line[]>(history.lines).map((line, i) => <tr key={i}><td>{s.products.find((p) => p.sku === line.sku)?.name ?? line.sku}<small>{line.sku}{line.batch ? " · Batch " + line.batch : ""}{line.godown ? " · " + line.godown : ""}</small></td><td>{line.quantity} {line.unit}</td></tr>)}</tbody></table>
          <p>
            See Reports for the full history. If contents change, print a new label and check the box again.
          </p>
        </Modal>
      )}
    </>
  );
}
export function TripsScreen(ctx: Context) {
  const { s } = ctx;
  const guidedOrderId = new URLSearchParams(window.location.search).get("order") ?? "";
  const guidedOrder = ctx.workflow === "OrderFirst" && !!guidedOrderId;
  const [creating, setCreating] = useState(false),
    [allocating, setAllocating] = useState<string | null>(() => new URLSearchParams(window.location.search).get("allocateTrip")),
    [vehicle, setVehicle] = useState(""),
    [driver, setDriver] = useState(""),
    [transporter, setTransporter] = useState(""),
    [customer, setCustomer] = useState(ctx.all.orders?.find(o => o.id === guidedOrderId)?.customerId ?? s.customers.find(tallyMasterAvailable)?.id ?? ""),
    [orderId, setOrderId] = useState(guidedOrderId),
    [destination, setDestination] = useState(ctx.all.orders?.find(o => o.id === guidedOrderId)?.destination ?? ""),
    [ids, setIds] = useState<string[]>([]),
    [inventorySource, setInventorySource] = useState(""),
    [inventoryData, setInventoryData] = useState<State | null>(null),
    [inventoryBusy, setInventoryBusy] = useState(false),
    [inventoryError, setInventoryError] = useState(""),
    [allocationError, setAllocationError] = useState("");
  useEffect(() => {
    if (!allocating || !inventorySource) { setInventoryData(null); setInventoryError(""); setInventoryBusy(false); return; }
    const controller = new AbortController();
    setInventoryData(null); setInventoryError(""); setInventoryBusy(true);
    loadWorkState(controller.signal, { kind: "packing", id: inventorySource }, ctx.workflow).then((data) => {
      if (controller.signal.aborted) return;
      if (data.workMissing) throw Error("Packing list not found.");
      setInventoryData(data);
    }).catch((e) => { if (!controller.signal.aborted) setInventoryError((e as Error).message); }).finally(() => { if (!controller.signal.aborted) setInventoryBusy(false); });
    return () => controller.abort();
  }, [allocating, inventorySource, ctx.workflow]);
  const selectedOrder = ctx.all.orders?.find(o => o.id === orderId);
  const remaining = selectedOrder ? selectedOrder.expectedCartons - orderCartons(ctx.all, selectedOrder) : null;
  const reservationContext = inventoryData ? { ...ctx, all: inventoryData } : ctx;
  const sourceCartons = inventorySource ? inventoryData?.workLoadedKey === "packing:" + inventorySource ? inventoryData.cartons.filter((c) => c.manifestId === inventorySource) : [] : ctx.work.kind === "packing" ? s.cartons : ctx.all.cartons;
  function eligibleOrderCartonIds(id: string) {
    const order = ctx.all.orders?.find(o => o.id === id);
    if (!order) return [];
    const left = Math.max(0, order.expectedCartons - orderCartons(ctx.all, order));
    const manifests = new Set(ctx.all.manifests.filter(m => m.orderId === id && m.state === "Approved").map(m => m.id));
    return ctx.all.cartons.filter(c => c.state === "Available" && c.verified && !c.held && manifests.has(c.manifestId)).slice(0, left).map(c => c.id);
  }
  function beginAllocation(tripId: string) {
    const order = ctx.all.orders?.find(o => o.id === guidedOrderId);
    setAllocating(tripId);
    setIds(eligibleOrderCartonIds(guidedOrderId));
    setOrderId(guidedOrderId);
    setInventorySource("");
    setAllocationError("");
    if (order) { setCustomer(order.customerId); setDestination(order.destination); }
  }
  useEffect(() => {
    // Restore the guided selection if the browser reloads while the allocation dialog is open.
    if (allocating && guidedOrderId && !ids.length) {
      const selected = eligibleOrderCartonIds(guidedOrderId);
      if (selected.length) setIds(selected);
      const order = ctx.all.orders?.find(o => o.id === guidedOrderId);
      if (order) { setCustomer(order.customerId); setDestination(order.destination); }
    }
  }, [allocating, guidedOrderId]);
  return (
    <>
      <Heading
        eyebrow={guidedOrder ? "STEP 4 OF 6" : "CUSTOMERS, BOXES AND VEHICLES"}
        title={guidedOrder ? "Choose a vehicle" : "Trips & customers"}
        detail={guidedOrder ? "Enter the vehicle and driver. The order and boxes will be filled in for you." : "Add a vehicle, choose customers, and reserve their boxes. Each customer has a separate shipment."}
        action={
          <button
            className="primary"
            disabled={!may(ctx, "DispatchSupervisor")}
            onClick={() => setCreating(true)}
          >
            <Plus size={17} />
            {guidedOrder ? "Next: vehicle details" : "New vehicle trip"}
          </button>
        }
      />
      {!s.trips.length ? (
        <section className="panel">
          <Empty
            title="No vehicle trips yet"
            detail="Create a trip, then reserve the verified boxes for each customer."
          />
        </section>
      ) : (
        <div className="trip-card-grid">{s.trips.map((t) => (
          <section className="panel trip-card work-card" key={t.id}>
            <details className="trip-foldout" name="vehicle-trips" open={s.trips.length === 1}>
            <summary>
              <WorkCardSummary state={ctx.all} scope={{ kind: "trip", id: t.id }} heading />
            </summary>
              <div className="trip-actions button-row">
                <DeleteWorkButton ctx={ctx} kind="trip" record={t} />
                <button
                  className="primary small"
                  disabled={
                    t.state !== "Open" || !may(ctx, "DispatchSupervisor")
                  }
                  onClick={() => {
                    beginAllocation(t.id);
                  }}
                >
                  {guidedOrder ? "Add order boxes" : "Add customer & boxes"}
                </button>
                {ctx.work.kind !== "trip" && <button className="text-link" onClick={() => ctx.selectWork({ kind: "trip", id: t.id })}>Show this trip</button>}
                <button
                  className="secondary small"
                  disabled={
                    t.state !== "Open" || !may(ctx, "DispatchSupervisor")
                  }
                  onClick={() => {
                    if (
                      confirm(
                        "Has the vehicle left? All shipments must have confirmed invoices and required documents.",
                      )
                    )
                      void action(ctx, "depart", {
                        id: t.id,
                        physicalConfirmed: true,
                      });
                  }}
                >
                  Record departure
                </button>
              </div>
            <div className="shipment-card-grid">{s.shipments
              .filter((x) => x.tripId === t.id)
              .map((sh) => {
                const a = s.allocations.filter(
                    (x) => x.shipmentId === sh.id && x.active,
                  ),
                  loaded = a.filter((x) => x.state === "Loaded").length;
                return (
                  <div className="shipment-row shipment-card" key={sh.id}>
                    <div>
                      <h3>
                        {s.customers.find((c) => c.id === sh.customerId)?.name}
                      </h3>
                      <p>{sh.destination}</p>
                      <small title={sh.id}>{shortReference(sh.id)}</small>
                    </div>
                    <div>
                      <strong>
                        {loaded} / {a.length}
                      </strong>
                      <small>cartons loaded</small>
                    </div>
                    <Badge tone={sh.loadApproved ? "sage" : "amber"}>
                      {sh.state}
                    </Badge>
                    <div className="button-row">
                      <button
                        className="secondary small"
                        onClick={() => { if (ctx.selectWork({ kind: "shipment", id: sh.id })) ctx.navigate(sh.loadApproved ? "billing" : "loading"); }}
                      >
                        {!sh.loadApproved && <ScanLine size={15} />}
                        {sh.loadApproved ? "Review billing" : "Scan in Labels"}
                      </button>
                      {!sh.loadApproved && <button
                        className="secondary small"
                        disabled={
                          sh.loadApproved || !may(ctx, "DispatchSupervisor")
                        }
                        onClick={() => {
                          if (
                            confirm(
                              "I checked that all reserved boxes are loaded on this vehicle.",
                            )
                          )
                            void action(ctx, "approveLoad", {
                              id: sh.id,
                              physicalConfirmed: true,
                            });
                        }}
                      >
                        Approve load
                      </button>}
                    </div>
                    <details className="shipment-options">
                      <summary>More actions</summary>
                      <div className="shipment-option-links">
                        <DeleteWorkButton ctx={ctx} kind="shipment" record={sh} />
                        <button className="text-link" onClick={() => { if (ctx.selectWork({ kind: "shipment", id: sh.id })) ctx.navigate("cartons"); }}>Labels</button>
                        <button className="text-link" onClick={() => { if (ctx.selectWork({ kind: "shipment", id: sh.id })) ctx.navigate("billing"); }}>Billing</button>
                        <button
                        className="text-link"
                        onClick={async () => {
                          try {
                            const doc = await api(
                              "/documents/shipment/" + sh.id,
                            );
                            await packingPdf(
                              doc.shipment,
                              doc.cartons,
                              doc.customer.name,
                            );
                          } catch (e) {
                            alert((e as Error).message);
                          }
                        }}
                      >
                        Packing list
                      </button>
                      </div>
                    <div className="shipment-detail">
                      {a
                        .filter((x) => x.state === "Loaded")
                        .map((x) => (
                          <button
                            key={x.id}
                            disabled={
                              sh.loadApproved || !may(ctx, "DispatchSupervisor")
                            }
                            className="text-link"
                            onClick={() => {
                              const reason = prompt(
                                "Reason for physically unloading " + x.cartonId,
                              );
                              if (reason)
                                void action(ctx, "unload", {
                                  id: x.cartonId,
                                  shipmentId: sh.id,
                                  reason,
                                });
                            }}
                          >
                            Unload {x.cartonId}
                          </button>
                        ))}
                      {a.every((x) => x.state === "Reserved") &&
                        !sh.loadApproved && (
                          <button
                            className="text-link danger"
                            disabled={!may(ctx, "DispatchSupervisor")}
                            onClick={() => {
                              const reason = prompt(
                                "Reason to cancel this unposted shipment and release reserved boxes",
                              );
                              if (reason)
                                void action(ctx, "releaseShipment", {
                                  id: sh.id,
                                  reason,
                                });
                            }}
                          >
                            Cancel shipment & free boxes
                          </button>
                        )}
                    </div>
                    </details>
                  </div>
                );
              })}</div>
            {!s.shipments.some((x) => x.tripId === t.id) && (
              <p className="panel-padding muted">
                Add the first customer shipment to this vehicle.
              </p>
            )}
            </details>
          </section>
        ))}</div>
      )}
      {creating && (
        <Modal title={guidedOrder ? "Vehicle details" : "Create vehicle trip"} close={() => setCreating(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await action(ctx, "createTrip", {
                  vehicle,
                  driver,
                  transporter,
                });
              if (result) {
                setCreating(false);
                if (ctx.workflow === "OrderFirst" && guidedOrderId) {
                  const url = new URL(window.location.href); url.searchParams.set("allocateTrip", result.id);
                  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
                  beginAllocation(result.id);
                }
                ctx.selectWork({ kind: "trip", id: result.id });
              }
            }}
          >
            <Field label="Vehicle registration">
              <input
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value.toUpperCase())}
                required
                minLength={4}
                placeholder="KA 01 AB 1234"
              />
            </Field>
            <Field label="Driver name">
              <input
                value={driver}
                onChange={(e) => setDriver(e.target.value)}
                required
                minLength={2}
              />
            </Field>
            <Field label="Transporter">
              <input
                value={transporter}
                onChange={(e) => setTransporter(e.target.value)}
              />
            </Field>
            <button className="primary wide">Create trip</button>
          </form>
        </Modal>
      )}
      {allocating && (
        <Modal
          title="Choose boxes for a customer"
          close={() => setAllocating(null)}
        >
          <p>{guidedOrder ? "Vehicle" : "Vehicle trip"}: <strong>{ctx.all.trips.find((t) => t.id === allocating)?.vehicle ?? allocating}</strong></p>
          {!guidedOrder && <OrderPicker ctx={ctx} value={orderId} required={ctx.workflow === "OrderFirst"} onChange={id => {
            setOrderId(id); setIds(eligibleOrderCartonIds(id)); setInventorySource("");
            const order = ctx.all.orders?.find(o => o.id === id);
            if (order) {
              setCustomer(order.customerId); setDestination(order.destination);
              if (ctx.workflow === "OrderFirst") {
              }
            }
          }} />}
          {guidedOrder && selectedOrder && <p className="notice"><strong>{selectedOrder.reference}</strong> · {s.customers.find(c => c.id === selectedOrder.customerId)?.name} · {remaining} boxes remaining. They are selected below.</p>}
          {allocationError && <div className="notice error" role="alert">{allocationError}</div>}
          {guidedOrder && !guidedOrderId && <p className="notice">Choose the order first. Customer and delivery details will fill in automatically.</p>}
          {!guidedOrder && selectedOrder && <p className="notice">{remaining} of {selectedOrder.expectedCartons} ordered boxes remain to assign. Partial shipments are allowed.</p>}
          {!guidedOrder && <Field label="Customer">
            <select
              value={customer}
              disabled={!!selectedOrder || ctx.workflow === "OrderFirst"}
              onChange={(e) => {
                setCustomer(e.target.value);
                setIds([]);
              }}
            >
              {s.customers.filter((c) => tallyMasterAvailable(c) || c.id === customer).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>}
          {!guidedOrder && <Field label="Delivery destination">
            <input
              value={destination}
              disabled={!!selectedOrder || ctx.workflow === "OrderFirst"}
              onChange={(e) => setDestination(e.target.value)}
            />
          </Field>}
          {!guidedOrder && <Field label="Choose packing list">
            <select aria-label="Choose packing list" value={inventorySource} onChange={(e) => { setInventorySource(e.target.value); setInventoryData(null); setIds([]); }}>
              <option value="">All shown packing lists</option>
              {ctx.all.manifests.filter((m) => m.state === "Approved" && (ctx.workflow !== "OrderFirst" || m.orderId === orderId)).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}
            </select>
          </Field>}
          {inventoryBusy && <p role="status">Loading this packing list’s boxes…</p>}
          {inventoryError && <div className="notice error" role="alert">{inventoryError}</div>}
          <p>
            {guidedOrder ? "Check the selected boxes. Change the selection only if this trip is carrying fewer boxes." : "Choose the boxes leaving in this shipment. Remaining boxes stay available for another day or vehicle."}
          </p>
          <GroupedRecords ctx={reservationContext} focusable={false} type="carton" rows={sourceCartons.filter(
                (c) =>
                  c.state === "Available" &&
                  c.verified &&
                  (ctx.workflow !== "OrderFirst" || ctx.all.manifests.some(m => m.id === c.manifestId && m.orderId === orderId)) &&
                  !c.held &&
                  (!c.customerId || c.customerId === customer),
              )}>{(records) => <><div className="group-actions"><button className="secondary small" onClick={() => setIds((previous) => records.every((c) => previous.includes(c.id)) ? previous.filter((id) => !records.some((c) => c.id === id)) : [...new Set([...previous, ...records.map((c) => c.id)])])}>{records.every((c) => ids.includes(c.id)) ? "Clear this group" : "Select group (" + records.length + (records.length === 1 ? " box)" : " boxes)")}</button></div><div className="allocation-list">{records.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={ids.includes(c.id)}
                    onChange={(e) =>
                      setIds((p) =>
                        e.target.checked
                          ? [...p, c.id]
                          : p.filter((x) => x !== c.id),
                      )
                    }
                  />
                  <span>
                    <strong>{c.id}</strong>
                    <small>
                      {parse<Line[]>(c.lines)
                        .map((l) => `${l.sku}: ${l.quantity} ${l.unit}`)
                        .join(" + ")}
                    </small>
                  </span>
                </label>
              ))}</div></>}</GroupedRecords>
          <button
            className="primary wide"
            disabled={!ids.length || inventoryBusy || !!inventoryError || (ctx.workflow === "OrderFirst" && !selectedOrder) || (remaining !== null && ids.length > remaining)}
            onClick={async () => {
              setAllocationError("");
              try {
                const result = await ctx.run("allocate", { tripId: allocating, customerId: customer, destination, orderId: orderId || null, ids });
                if (result) { setAllocating(null); const url = new URL(window.location.href); url.searchParams.delete("allocateTrip"); window.history.replaceState(null, "", url.pathname + url.search + url.hash); if (ctx.selectWork({ kind: "shipment", id: result.id })) ctx.navigate("loading"); }
              } catch (e) { setAllocationError((e as Error).message || "Could not assign these boxes. Check the order and try again."); }
            }}
          >
            {guidedOrder ? `Next: assign ${ids.length} ${ids.length === 1 ? "box" : "boxes"}` : `Reserve ${ids.length} ${ids.length === 1 ? "box" : "boxes"}`}
          </button>
        </Modal>
      )}
    </>
  );
}

export function BillingScreen(ctx: Context) {
  const { s } = ctx;
  const [editing, setEditing] = useState<Row | null>(null);
  const [queueingShipment, setQueueingShipment] = useState("");
  const [queuedShipmentId, setQueuedShipmentId] = useState("");
  const [queueError, setQueueError] = useState("");
  const [invoicePreview, setInvoicePreview] = useState<{ url: string; fileName: string; shipmentId: string } | null>(null);
  const [statutoryReference, setStatutoryReference] = useState("");
  useEffect(() => () => { if (invoicePreview?.url) URL.revokeObjectURL(invoicePreview.url); }, [invoicePreview?.url]);
  const queuedJob = s.jobs.find((job) => job.shipmentId === queuedShipmentId);
  const invoiceStillGenerating = !!queueingShipment || (!!queuedShipmentId && (!queuedJob || ["Queued", "Claimed", "Sending", "ConfirmationUnknown"].includes(queuedJob.state)));
  useEffect(() => {
    if (queuedJob && !["Queued", "Claimed", "Sending", "ConfirmationUnknown"].includes(queuedJob.state)) setQueuedShipmentId("");
  }, [queuedShipmentId, queuedJob?.state]);
  return (
    <>
      <Heading
        eyebrow="REVIEW FIRST. POST ONCE."
        title="Billing & Tally"
        detail="Check the prices for each customer after the load is approved."
      />
      {queueError && <div className="notice error" role="alert">{queueError}</div>}
      {invoiceStillGenerating && <div className="notice amber" role="status">A Tally sales invoice was queued. No driver release occurs until Tally readback is confirmed.</div>}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Customer bills</h2>
            <p>Loading approval is required before pricing.</p>
          </div>
        </div>
        {s.shipments.filter((sh) => sh.state !== "Cancelled").length ? (
          <div className="table-wrap">
            <GroupedRecords ctx={ctx} rows={s.shipments.filter((sh) => sh.state !== "Cancelled")} type="shipment">{(records) => (<table>
              <thead>
                <tr>
                  <th>SHIPMENT / CUSTOMER</th>
                  <th>LOAD</th>
                  <th>REVISION</th>
                  <th>DRAFT NET</th>
                  <th>REVIEW</th>
                </tr>
              </thead>
              <tbody>
                {records.map((sh) => {
                    const bill = s.billings.find(
                      (b) =>
                        b.shipmentId === sh.id &&
                        b.revision === sh.billingVersion,
                    );
                    return (
                      <tr key={sh.id}>
                        <td>
                          <strong>
                            {
                              s.customers.find((c) => c.id === sh.customerId)
                                ?.name
                            }
                          </strong>
                          <small>{sh.id}</small>
                        </td>
                        <td>
                          <Badge tone={sh.loadApproved ? "sage" : "amber"}>
                            {sh.loadApproved ? "Approved" : "Review required"}
                          </Badge>
                        </td>
                        <td>
                          {bill ? "Version " + bill.revision : "No draft"}
                          {bill && (
                            <small>
                              {bill.approved ? "Approved" : "Unapproved"}
                            </small>
                          )}
                        </td>
                        <td>
                          {bill ? money(bill.total) : "—"}
                          <small>Before unresolved taxes</small>
                        </td>
                        <td>
                          <div className="button-row">
                            <button
                              className="secondary small"
                              disabled={
                                !sh.loadApproved ||
                                !!sh.invoiceJobId ||
                                !may(ctx, "Billing")
                              }
                              onClick={() => setEditing(sh)}
                            >
                              Edit billing
                            </button>
                            {bill && !bill.approved && (
                              <button
                                className="primary small"
                                disabled={!may(ctx, "Billing")}
                                onClick={() => {
                                  if (
                                    confirm(
                                      "I checked this bill and the correct customer shipment.",
                                    )
                                  )
                                    void action(ctx, "approveBilling", {
                                      id: bill.id,
                                      physicalConfirmed: true,
                                    });
                                }}
                              >
                                Approve version {bill.revision}
                              </button>
                            )}
                            {bill?.approved && !sh.invoiceJobId && (
                              <button
                                className="secondary small"
                                disabled={!may(ctx, "Billing") || queueingShipment === sh.id}
                                onClick={async () => {
                                  setQueueError(""); setQueueingShipment(sh.id);
                                  try {
                                    const result = await ctx.run("queueInvoice", { id: sh.id });
                                    if (!result?.id) throw Error(result?.message ?? "Tally did not accept the invoice request.");
                                    setQueuedShipmentId(sh.id);
                                  } catch (error) {
                                    setQueueError(`Invoice was not queued: ${(error as Error).message}. Check the status below before retrying.`);
                                    setQueuedShipmentId("");
                                  } finally { setQueueingShipment(""); }
                                }}
                              >
                                {queueingShipment === sh.id ? "Checking Tally…" : "Create sales invoice in Tally"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>)}</GroupedRecords>
          </div>
        ) : (
          <Empty
            title="No bills yet"
            detail="Reserve boxes, scan them during loading, and approve the load to start billing."
          />
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Tally invoice status</h2>
            <p>If a result is missing, check it before trying again.</p>
          </div>
          <Badge tone={s.postingEnabled ? "sage" : "amber"}>{s.demoTaxSetup ? "TEST shipment only · DEMO GST" : s.postingEnabled ? "Tally connection and mapping ready" : "Tally setup needed"}</Badge>
        </div>
        {s.jobs.length ? (
          <GroupedRecords ctx={ctx} rows={s.jobs} type="job">{(records) => (<table>
            <thead>
              <tr>
                <th>OPERATION</th>
                <th>STATUS</th>
                <th>DETAIL</th>
                <th>VOUCHER</th>
                <th>DOCUMENT</th>
              </tr>
            </thead>
            <tbody>
              {records.map((j) => {
                let jobDetail: Row = {};
                try { jobDetail = JSON.parse(j.detail); } catch { /* retain raw detail below */ }
                const linkedShipment = s.shipments.find((shipment) => shipment.id === j.shipmentId);
                const linkedOrder = linkedShipment?.orderId ? (s.orders ?? []).find((order) => order.id === linkedShipment.orderId) : undefined;
                const linkedCustomer = s.customers.find((customer) => customer.id === linkedShipment?.customerId);
                const trialShipment = linkedShipment?.id?.toUpperCase() === "SH-DF278E58C71F4304BEDB" ||
                  (linkedOrder?.reference === "PO-1234-TEST" && linkedCustomer?.name === "TEST - Bengaluru Machine Works");
                return <tr key={j.id}>
                  <td>
                    <strong className="mono">{j.id.slice(0, 16)}</strong>
                    <small>{j.shipmentId}</small>
                  </td>
                  <td>
                    <Badge tone={j.state === "Confirmed" ? "sage" : "amber"}>
                      {j.state === "Confirmed" ? "Completed" : j.state}
                    </Badge>
                  </td>
                  <td>
                    {jobDetail.message ?? j.detail}
                    {(j.state === "Queued" || j.state === "Claimed") && <div style={{ marginTop: 8 }}>
                      <button className="secondary small" disabled={!may(ctx, "Billing")} onClick={async () => {
                        const reference = String((jobDetail.payload as Row | undefined)?.reference ?? "");
                        if (!reference) { setQueueError("This request has no readable reference. Contact an administrator before changing it."); return; }
                        if (!confirm(`Retire this invoice request only? The original request and shipment history will stay. This reopens the approved bill so you can submit a fresh request. First confirm you searched Tally for exact reference ${reference} and found no voucher. If the connector has started sending, this action will be blocked.`)) return;
                        const checkedReference = prompt(`Type the exact Tally reference you searched for:\n${reference}`);
                        if (checkedReference !== reference) { if (checkedReference !== null) setQueueError("Reference did not match. Nothing was changed."); return; }
                        const reason = prompt("Why are you retiring this unsent invoice request?", "Tally exact-reference search found no voucher; replacing stale request after ledger mapping correction");
                        if (!reason || reason.trim().length < 3) return;
                        try {
                          const result = await ctx.run("cancelUnsentInvoice", { id: j.id, expectedReference: checkedReference, verifiedNoVoucher: true, reason: reason.trim() });
                          setQueueError(result?.message ?? "Old invoice request retired. The approved bill is available for a fresh review.");
                        } catch (error) { setQueueError(`Request not changed: ${(error as Error).message}`); }
                      }}>Retire unsent invoice request</button>
                    </div>}
                    {trialShipment && <small>This known legacy trial is kept in history. Tally invoice retries are blocked for this shipment.</small>}
                    {j.state === "ConfirmationUnknown" && !jobDetail.retryAuthorized && !trialShipment && <div style={{ marginTop: 8 }}>
                      <button className="secondary small" disabled={!may(ctx, "Billing")} onClick={async () => {
                        const reference = String((jobDetail.payload as Row | undefined)?.reference ?? "");
                        if (!reference) { setQueueError("This invoice has no readable Tally reference. Contact an administrator before retrying."); return; }
                        if (!confirm(`Tally’s exact-reference search found no voucher for ${reference}. Authorize one retry? The connector will search that exact reference again before sending, and will confirm an existing voucher instead of creating a duplicate.`)) return;
                        const checkedReference = prompt(`Type the exact Tally reference you searched for:\n${reference}`);
                        if (checkedReference !== reference) { if (checkedReference !== null) setQueueError("Reference did not match. Nothing was changed."); return; }
                        const reason = prompt("Why are you authorizing this invoice retry?", "Searched Tally for the exact reference; no voucher found");
                        if (!reason || reason.trim().length < 3) return;
                        try {
                          const result = await ctx.run("authorizeInvoiceRetry", { id: j.id, verifiedNoVoucher: true, reason: reason.trim() });
                          setQueueError(result?.message ?? "One safe retry is authorized. The connector will search Tally before sending.");
                        } catch (error) { setQueueError(`Retry not authorized: ${(error as Error).message}`); }
                      }}>Authorize one safe retry</button>
                    </div>}
                    {jobDetail.retryAuthorized && <small>One retry authorized; the connector will recheck Tally before sending.</small>}
                  </td>
                  <td>{j.voucherReference ?? "No confirmed voucher"}</td>
                  <td>
                    {j.state === "Confirmed" && <button className="secondary small" onClick={async () => {
                      try {
                        const document = await api<Row>(`/documents/invoice/${encodeURIComponent(j.shipmentId)}`);
                        const pdf = await invoicePdf(document);
                        setInvoicePreview({ url: URL.createObjectURL(pdf.blob), fileName: pdf.fileName, shipmentId: j.shipmentId });
                      }
                      catch (error) { window.alert((error as Error).message); }
                    }}>View, download & print invoice</button>}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>)}</GroupedRecords>
        ) : (
          <Empty
            title="No invoices sent"
            detail="After the load is approved, review and approve its bill, then click Create sales invoice in Tally. The connector sends it and checks Tally's voucher before driver documents can be released."
          />
        )}
      </section>
      {editing && (
        <BillingEditor
          ctx={ctx}
          shipment={editing}
          close={() => setEditing(null)}
        />
      )}
      {invoicePreview && (
        <Modal title="Tally-confirmed invoice" close={() => setInvoicePreview(null)}>
          <p>Review the invoice copy below. It is generated from the voucher Tally confirmed.</p>
          {s.jobs.find((j) => j.shipmentId === invoicePreview.shipmentId)?.detail?.toLowerCase().includes("demo") && <div className="notice amber">This voucher uses demo tax setup. Verify with the accountant before issuing it to a customer.</div>}
          <iframe id="invoice-pdf-preview" title="Invoice PDF preview" src={invoicePreview.url} style={{ width: "100%", height: "65vh", border: "1px solid #d8e1eb", borderRadius: 8 }} />
          {s.mapping.statutoryRequired && <Field label="Applicable statutory reference"><input required value={statutoryReference} onChange={e => setStatutoryReference(e.target.value)} placeholder="Enter the reference required for this dispatch" /></Field>}
          <div className="button-row" style={{ marginTop: 12 }}>
            <a className="primary button-link" href={invoicePreview.url} download={invoicePreview.fileName}>Download PDF</a>
            <button className="secondary" onClick={() => (document.getElementById("invoice-pdf-preview") as HTMLIFrameElement | null)?.contentWindow?.print()}>Print invoice</button>
            <button className="secondary" onClick={async () => {
              if (s.mapping.statutoryRequired && !statutoryReference.trim()) return;
              try {
                await ctx.run("recordDocuments", { id: invoicePreview.shipmentId, print: "OperatorConfirmed", statutoryReference, reason: "Operator confirmed printing and checked the Tally-confirmed invoice" });
                setInvoicePreview(null);
                setStatutoryReference("");
              } catch (error) { window.alert((error as Error).message); }
            }} disabled={s.mapping.statutoryRequired && !statutoryReference.trim()}>I printed and checked it</button>
          </div>
        </Modal>
      )}
    </>
  );
}
function BillingEditor({
  ctx,
  shipment,
  close,
}: {
  ctx: Context;
  shipment: Row;
  close: () => void;
}) {
  const s = ctx.all;
  const ids = s.allocations
    .filter((a) => a.shipmentId === shipment.id && a.active)
    .map((a) => a.cartonId);
  const cartons = s.cartons.filter((c) => ids.includes(c.id));
  const ts = totals(cartons);
  const missingTallyPrices = ts.filter((item) => s.products.find((p) => p.sku === item.sku)?.tallySellingPrice == null).length;
  const previous = s.billings.find(
    (b) =>
      b.shipmentId === shipment.id && b.revision === shipment.billingVersion,
  );
  const previousData = previous ? parse(previous.snapshot) : null;
  const [rates, setRates] = useState(
      ts.map((t) => ({
        sku: t.sku,
        rate: String(
          previousData?.lines.find((l: Row) => l.sku === t.sku)?.rate ?? s.products.find((p) => p.sku === t.sku)?.tallySellingPrice ?? "",
        ),
        discountPercent: String(
          previousData?.lines.find((l: Row) => l.sku === t.sku)
            ?.discountPercent ?? "0",
        ),
      })),
    ),
    [freight, setFreight] = useState(String(previousData?.freight ?? "0")),
    [charges, setCharges] = useState(String(previousData?.otherCharges ?? "0")),
    [reason, setReason] = useState(""),
    [terms, setTerms] = useState(previousData?.terms ?? ""),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  useEffect(() => {
    if (previousData) return;
    setRates((current) =>
      current.map((line) => {
        if (line.rate.trim()) return line;
        const tallyRate = s.products.find((product) => product.sku === line.sku)?.tallySellingPrice;
        return tallyRate == null ? line : { ...line, rate: String(tallyRate) };
      }),
    );
  }, [s.products, previousData]);
  return (
    <Modal title="Check bill" close={close}>
      <p><strong>{shipmentName(ctx.all, shipment.id)}</strong></p>
      <div className={"notice " + (missingTallyPrices ? "amber" : "sage")}>
        {missingTallyPrices === 0
          ? "Prices are prefilled from the latest Tally standard selling prices. Confirm the customer rate before saving. Item GST follows Tally; freight and other charges use the same weighted GST mix and Tally’s Forwarding Charges ledger."
          : `${ts.length - missingTallyPrices} of ${ts.length} item prices came from Tally. Enter an approved price for the ${missingTallyPrices} item${missingTallyPrices === 1 ? "" : "s"} without a Tally standard selling price. Item GST follows Tally; freight and other charges use the same weighted GST mix and Tally’s Forwarding Charges ledger.`}
      </div>
      <div className="notice amber">Item discounts entered here apply to this invoice only; they do not change the product’s standard price in Tally. Tally must have item-wise discount enabled for this sales invoice.</div>
      {cartons.length !== ids.length && (
        <div className="notice error">
          Some box details are missing from this page. Load all shipment details before entering prices.
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          setSaving(true);
          setSaveError("");
          try {
            await ctx.run("saveBilling", {
              shipmentId: shipment.id,
              rates,
              freight,
              otherCharges: charges,
              reason,
              terms,
              version: shipment.billingVersion,
            });
            close();
          } catch (error) {
            setSaveError((error as Error).message || "Could not save this bill. Check the fields and try again.");
          } finally {
            setSaving(false);
          }
        }}
      >
        {rates.map((r, i) => (
          <section className="group-editor" key={r.sku}>
            <strong>
              {r.sku} · {ts[i].quantity} {ts[i].unit}
            </strong>
            {s.products.find((p) => p.sku === r.sku)?.tallySellingPrice != null && <small className="muted">Tally standard price: ₹{number(s.products.find((p) => p.sku === r.sku)!.tallySellingPrice)}</small>}
            <div className="form-grid">
              <Field label="Price per unit (₹)">
                <input
                  inputMode="decimal"
                  value={r.rate}
                  onChange={(e) =>
                    setRates((p) =>
                      p.map((x, j) =>
                        i === j ? { ...x, rate: e.target.value } : x,
                      ),
                    )
                  }
                  required
                />
              </Field>
              <Field label="Item discount (%)">
                <input
                  inputMode="decimal"
                  value={r.discountPercent}
                  onChange={(e) =>
                    setRates((p) =>
                      p.map((x, j) =>
                        i === j ? { ...x, discountPercent: e.target.value } : x,
                      ),
                    )
                  }
                  required
                />
              </Field>
            </div>
          </section>
        ))}
        <div className="form-grid">
          <Field label="Freight before tax (₹)">
            <input
              value={freight}
              onChange={(e) => setFreight(e.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Field label="Other charges before tax (₹)">
            <input
              value={charges}
              onChange={(e) => setCharges(e.target.value)}
              inputMode="decimal"
            />
          </Field>
        </div>
        <Field label="Terms override (optional — leave blank for the standard invoice copy)">
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} />
        </Field>
        <Field label="Price / terms note (optional)">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {saveError && <p className="notice error" role="alert">Bill not saved: {saveError}</p>}
        <button
          className="primary wide"
          disabled={cartons.length !== ids.length || saving}
        >
          {saving ? "Saving bill…" : "Save changes · approval will be needed again"}
        </button>
      </form>
    </Modal>
  );
}
export function SetupScreen(ctx: Context) {
  const { s } = ctx;
  const m = s.mapping;
  const [expectedCompany, setCompany] = useState(m.expectedCompany),
    [version, setVersion] = useState(m.tallyVersion),
    [ledger, setLedger] = useState(m.salesLedger),
    [voucherType, setVoucherType] = useState(m.voucherType),
    [notes, setNotes] = useState(m.notes ?? ""),
    [statutory, setStatutory] = useState(m.statutoryRequired),
    [pair, setPair] = useState<Row | null>(null),
    [userModal, setUserModal] = useState(false);
  const productionConnector = s.connectors.find((c) => !c.revoked && c.environment === "Production" && c.expectedCompany === expectedCompany);
  const salesLedgers: string[] = Array.from(new Set<string>((productionConnector?.ledgerOptions ?? []).filter((x: Row) => x.group === "Sales Accounts").map((x: Row) => String(x.name))));
  return (
    <>
      <Heading
        eyebrow="CONNECTED, WITH THE RIGHT BOUNDARIES"
        title="Settings"
        detail={site ? "Manage this company's products, customers, scanner workstation and separate Tally connection." : "One setup for both workflows. Manage shared products, customers, devices and the Tally connection."}
      />
      <SharedMasters ctx={ctx} />
      <WorkstationSettings ctx={ctx} />
      <div className="setup-steps">
        {[
          ["1", "Pair connector", "Install beside Tally. Outbound HTTPS only."],
          [
            "2",
            "Confirm company",
            "Exact identity. No active-company fallback.",
          ],
          [
            "3",
            "Map & validate",
            "Validate this company's ledgers, items, HSN/GST and customer data.",
          ],
        ].map(([n, title, detail]) => (
          <section className="panel" key={n}>
            <span className="setup-number">{n}</span>
            <h3>{title}</h3>
            <p>{detail}</p>
          </section>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel panel-padding">
          <h2>Tally settings for the accountant</h2>
          <p>Changes are recorded. The accountant must check the settings again after any change.</p>
          <div className="notice amber">TallyPrime Educational Mode restricts voucher dates to the 1st, 2nd, or 31st of the month. A licensed TallyPrime edition is needed for regular production invoicing.</div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await action(ctx, "saveMapping", {
                expectedCompany,
                tallyVersion: version,
                salesLedger: ledger,
                voucherType,
                notes,
                statutoryRequired: statutory,
                reason: "Tally settings for the accountant update",
              });
            }}
          >
            <Field label="Exact Tally company name">
              <input
                value={expectedCompany}
                onChange={(e) => setCompany(e.target.value)}
                required
              />
            </Field>
            <div className="form-grid">
              <Field label="Installed TallyPrime version">
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                />
              </Field>
              <Field label="Voucher type">
                <input
                  value={voucherType}
                  onChange={(e) => setVoucherType(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Sales ledger (exact name)">
              <select
                value={ledger}
                onChange={(e) => setLedger(e.target.value)}
                required
              >
                <option value="">Select a ledger from the latest Tally sync</option>
                {salesLedgers.map((name) => <option key={name} value={name}>{name}</option>)}
                {ledger && !salesLedgers.includes(ledger) && <option value={ledger}>{ledger} (not in latest sync)</option>}
              </select>
            </Field>
            <Field label="Notes on items, units, GST, and freight">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <label className="check-field">
              <input
                type="checkbox"
                checked={statutory}
                onChange={(e) => setStatutory(e.target.checked)}
              />
              Require applicable statutory references before departure.
            </label>
            <button className="primary" disabled={!may(ctx, "Billing")}>
              Save settings
            </button>
            <div className={m.contractValidated ? "notice" : "notice amber"}>
              {m.contractValidated ? "Production invoice mapping is enabled for this exact company." : "Production invoice posting stays off until the exact company and ledgers are validated."}
            </div>
          </form>
          <div className="panel-padding">
            <h3>{site?.slug === "aromazon" ? "AROMAZEN" : "Electro"} production invoice mapping</h3>
            <p>{m.contractValidated ? "The exact company and invoice mapping are validated. Approved invoices will be posted to its connected Tally company." : "Validate the exact company, Sales ledger, GST ledgers, product HSN/GST data and customer states before enabling invoice posting."}</p>
            <button className="primary" disabled={!may(ctx, "Billing") || !productionConnector || !ledger || !salesLedgers.includes(ledger) || voucherType !== "Sales" || (site?.slug === "aromazon" ? expectedCompany.length < 3 : expectedCompany !== "ELECTRO GROUP OF INDUSTRIES")} onClick={() => {
              const confirmed = confirm(site?.slug === "aromazon" ? `Confirm Tally is open to ${expectedCompany} and these are AROMAZEN’s production ledgers. Approved invoices will be entered into that company.` : "Confirm Tally is open to ELECTRO GROUP OF INDUSTRIES and that these are its production ledgers. Approved dispatch invoices will be entered into this company. This connection applies only to Electro Group.");
              if (confirmed) void action(ctx, "validateTallyContract", { confirmedCompany: true, reason: site?.slug === "aromazon" ? "Operator confirmed AROMAZEN production company and exact Tally ledger mapping" : "Operator confirmed Electro production company and exact Tally ledger mapping" });
            }}>
              Validate {site?.slug === "aromazon" ? "AROMAZEN" : "Electro"} production invoice setup
            </button>
            <p className="muted">{productionConnector ? `Connected company: ${productionConnector.expectedCompany}. Choose a Sales Accounts ledger from its latest sync.` : "Connect the Tally PC and wait for a fresh heartbeat and master sync first."}</p>
          </div>
        </section>
        <section className="panel panel-padding">
          <h2>Tally PC connections</h2>
          <p>Pair the connector installed on the Tally PC.</p>
          <button
            className="secondary"
            disabled={!may(ctx) || expectedCompany.length < 3}
            onClick={async () => {
              const r = await action(ctx, "pairConnector", {
                name: site?.slug === "aromazon" ? "AROMAZEN Tally PC" : "Electro Tally PC",
                expectedCompany,
              });
              if (r) setPair(r);
            }}
          >
            <Plus size={16} />
            Connect a Tally company
          </button>
          {s.connectors.map((c) => (
            <div className="connector-card" key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <Badge tone={c.revoked ? "red" : "amber"}>
                  {c.revoked ? "Disconnected" : "Production scope"}
                </Badge>
              </div>
              <p>{c.expectedCompany}</p>
              <small>Last heartbeat: {date(c.lastSeen)}</small>
              <small>Last Tally master read: {c.mastersSyncedAt ? date(c.mastersSyncedAt) : "Waiting for the updated connector to read products and ledgers."}</small>
              <p>
                {parse(c.diagnostics).detail ??
                  "Waiting for the Tally PC to connect."}
              </p>
              <button
                className="text-link danger"
                disabled={c.revoked || !may(ctx)}
                onClick={() =>
                  action(ctx, "revokeConnector", {
                    id: c.id,
                    reason: "Administrator revoked pairing",
                  })
                }
              >
                Disconnect
              </button>
            </div>
          ))}
          {!s.connectors.length && (
            <Empty
              title="No Tally PC connected yet"
              detail="Install the connector on the PC running Tally, then pair it here."
            />
          )}
          {ctx.workflow === "OrderFirst" && s.connectors.some((c) => !c.revoked) && (
            <div className="panel-padding">
              <p className="notice">Products and customer ledgers sync from Tally automatically while the connector is running. Latest sync: {date(s.connectors.filter((c) => !c.revoked).map((c) => c.mastersSyncedAt).filter(Boolean).sort().at(-1))}.</p>
              <p className="muted">Names, units, stock balance, HSN/GST details, customer GSTIN, and ledger address refresh automatically. Dispatch refreshes the screen every 15 seconds. Existing packed/shipped records keep their saved details.</p>
            </div>
          )}
          <div className="notice">
            Check the D-5015 scanner battery and receiver by hand. Use Test voice on the loading screen to check the PC sound.
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Users & roles</h2>
            <p>Choose which jobs each person can do.</p>
          </div>
          <button
            className="secondary small"
            disabled={!may(ctx)}
            onClick={() => setUserModal(true)}
          >
            Add user
          </button>
        </div>
        {s.users?.length ? (
          <table>
            <thead>
              <tr>
                <th>NAME</th>
                <th>EMAIL</th>
                <th>ROLES</th>
              </tr>
            </thead>
            <tbody>
              {s.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.roles.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="panel-padding muted">
            Only an administrator can manage users.
          </div>
        )}
      </section>
      {pair && (
        <Modal
          title="Pairing credential · copy now"
          close={() => setPair(null)}
        >
          <p>
            Run the connector's <code>--pair</code> command on the separate
            Tally PC. Enter the key at the hidden prompt.
          </p>
          <Field label="Connector ID">
            <input value={pair.id} readOnly />
          </Field>
          <Field label="Pairing key">
            <input
              value={pair.secret}
              readOnly
              type="password"
              onFocus={(e) => (e.target.type = "text")}
              onBlur={(e) => (e.target.type = "password")}
            />
          </Field>
          <p>
            The key is never included in audit exports. Revoke and pair again if
            it is lost.
          </p>
        </Modal>
      )}
      {userModal && <UserEditor ctx={ctx} close={() => setUserModal(false)} />}
    </>
  );
}
function UserEditor({ ctx, close }: { ctx: Context; close: () => void }) {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [roles, setRoles] = useState<string[]>(["MD"]);
  return (
    <Modal title="Add user" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await action(ctx, "createUser", { name, email, password, roles }))
            close();
        }}
      >
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Email">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </Field>
        <Field label="Initial password (12+ characters)">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Field>
        <div className="role-grid">
          {[
            "Admin",
            "PackingClerk",
            "PackingSupervisor",
            "Loader",
            "DispatchSupervisor",
            "Billing",
            "MD",
          ].map((r) => (
            <label className="check-field" key={r}>
              <input
                type="checkbox"
                checked={roles.includes(r)}
                onChange={(e) =>
                  setRoles((p) =>
                    e.target.checked ? [...p, r] : p.filter((x) => x !== r),
                  )
                }
              />
              {plainLabel(r)}
            </label>
          ))}
        </div>
        <button className="primary wide">Create user</button>
      </form>
    </Modal>
  );
}
export function ReturnsScreen(ctx: Context) {
  const { s } = ctx;
  const [open, setOpen] = useState(false),
    [shipmentId, setShipment] = useState(""),
    [cartonId, setCarton] = useState(""),
    [reason, setReason] = useState(""),
    [condition, setCondition] = useState("Uninspected"),
    [lines, setLines] = useState<Line[]>([]),
    [sourceLines, setSourceLines] = useState<Line[]>([]),
    [checkedCarton, setCheckedCarton] = useState(""),
    [finding, setFinding] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Heading
        eyebrow="HISTORY STAYS INTACT"
        title="Returns"
        detail="Keep returned goods separate for checking. For goods still on the vehicle, use Unload on the trip."
        action={
          <button
            className="primary"
            disabled={!may(ctx, "DispatchSupervisor")}
            onClick={() => setOpen(true)}
          >
            <Plus size={17} />
            Record return
          </button>
        }
      />
      <div className="notice">
        A return does not undo the original dispatch. Check the goods and ask accounts to approve any credit or stock update.
      </div>
      <section className="panel">
        {s.returns.length ? (
          <GroupedRecords ctx={ctx} rows={s.returns} type="return">{(records) => (<table>
            <thead>
              <tr>
                <th>ORIGINAL BOX</th>
                <th>RETURNED CONTENTS</th>
                <th>GOODS CHECK</th>
                <th>ACCOUNTING</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.cartonId}</strong>
                    <small>{r.shipmentId}</small>
                  </td>
                  <td>
                    {parse<Line[]>(r.lines).map((l, i) => (
                      <div key={i}>
                        {l.sku} · {l.quantity} {l.unit}
                      </div>
                    ))}
                    <small>{r.reason}</small>
                  </td>
                  <td>
                    <Badge tone="amber">{r.state}</Badge>
                    <div className="button-row">
                      {[
                        "Quarantine",
                        "Disposal",
                        "AwaitingAccountingRestock",
                      ].map((disposition) => (
                        <button
                          className="text-link"
                          key={disposition}
                          disabled={!may(ctx, "PackingSupervisor")}
                          onClick={() => {
                            const reason = prompt("Reason for this decision");
                            if (reason)
                              void action(ctx, "returnDisposition", {
                                id: r.id,
                                disposition,
                                reason,
                              });
                          }}
                        >
                          {plainLabel(disposition)}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>{r.accountingStatus === "Credit/stock movement pending accountant review" ? "Accounts must check the credit and stock update." : r.accountingStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>)}</GroupedRecords>
        ) : (
          <Empty
            title="No returned boxes"
            detail="Record returned goods using the original shipment and box."
          />
        )}
      </section>
      {open && (
        <Modal
          title="Record returned goods"
          close={() => setOpen(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                setError("");
                if (checkedCarton !== cartonId.trim()) throw Error("Find and check the box before saving.");
                const returned = lines.filter((line) => Number(line.quantity) > 0);
                if (!returned.length) throw Error("Enter at least one returned quantity.");
                if (
                  await ctx.run("recordReturn", {
                    shipmentId,
                    id: cartonId,
                    lines: returned,
                    reason,
                    condition,
                  })
                )
                  setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Field label="Original dispatched shipment">
              <select
                value={shipmentId}
                onChange={(e) => { setShipment(e.target.value); setCarton(""); setLines([]); setSourceLines([]); setCheckedCarton(""); }}
                required
              >
                <option value="">Select original shipment</option>
                <ShipmentChoices ctx={ctx} shipments={s.shipments.filter((sh) => sh.state === "Departed")} />
              </select>
            </Field>
            <Field label="Original box ID">
              <input value={cartonId} disabled={finding} onChange={(e) => { setCarton(e.target.value); setCheckedCarton(""); setLines([]); setSourceLines([]); }} required />
            </Field>
            <button type="button" className="secondary" disabled={!shipmentId || !cartonId.trim() || finding} onClick={async () => {
              const requested = cartonId.trim();
              setError(""); setFinding(true);
              try {
                const { carton } = await api("/cartons/" + encodeURIComponent(requested) + "/history");
                const belongs = s.allocations.some((a) => a.shipmentId === shipmentId && a.cartonId === requested && a.active && a.state === "Departed");
                if (!belongs) throw Error("This box does not belong to the selected dispatched shipment.");
                const original = parse<Line[]>(carton.lines);
                setSourceLines(original); setLines(original.map((line) => ({ ...line, quantity: "0" }))); setCarton(requested); setCheckedCarton(requested);
              } catch (e) { setError((e as Error).message); } finally { setFinding(false); }
            }}>{finding ? "Finding…" : "Find box contents"}</button>
            {lines.length > 0 && <div className="return-quantities"><p>Enter the quantity returned for each item. Leave other items at 0.</p>{lines.map((line, i) => <Field key={i} label={(s.products.find((p) => p.sku === line.sku)?.name ?? line.sku) + " · " + line.sku + " (" + line.unit + ")"}><input type="number" min="0" max={Number(sourceLines[i].quantity)} step="any" value={line.quantity} onChange={(e) => setLines((previous) => previous.map((item, j) => i === j ? { ...item, quantity: e.target.value } : item))} required /><small>Original box quantity: {sourceLines[i].quantity} {line.unit}</small></Field>)}</div>}
            <Field label="Reason">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
                required
              />
            </Field>
            <Field label="Physical condition">
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              >
                <option value="Uninspected">Not checked yet</option>
                <option>Sealed</option>
                <option>Opened</option>
                <option>Damaged</option>
              </select>
            </Field>
            {error && <div className="notice error">{error}</div>}
            <button className="primary wide">
              Save return & keep goods separate
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function ReportsScreen(ctx: Context) {
  const { s } = ctx;
  const itemCodes = new Set(s.cartons.flatMap((c) => parse<Line[]>(c.lines).map((line) => line.sku)));
  const products = ctx.work.kind === "all" ? s.products : s.products.filter((p) => itemCodes.has(p.sku));
  return (
    <>
      <Heading
        eyebrow="TRACEABLE FROM PACKING TO DEPARTURE"
        title="Reports"
        detail="See who packed, checked, loaded, and changed each record."
        action={
          <button
            className="secondary"
            onClick={() => {
              const rows = [
                ["time", "actor", "action", "entity", "data"],
                ...s.audit.map((a) => [
                  a.at,
                  a.actorId,
                  a.action,
                  a.entityId,
                  a.data,
                ]),
              ];
              download(
                "dispatch-audit-current-page.csv",
                rows.map((r) => r.map(safeCsv).join(",")).join("\r\n"),
              );
            }}
          >
            <FileDown size={16} />
            Download this history page
          </button>
        }
      />
      <div className="metrics">
        <div className="metric">
          <span>Registered boxes</span>
          <div className="metric-value">{s.cartonTotal}</div>
          <p>Registered boxes</p>
        </div>
        <div className="metric">
          <span>Trips departed</span>
          <div className="metric-value">
            {s.trips.filter((x) => x.state === "Departed").length}
          </div>
          <p>Shown on this page</p>
        </div>
        <div className="metric">
          <span>Returns quarantined</span>
          <div className="metric-value">
            {s.returns.filter((x) => x.state === "Quarantine").length}
          </div>
          <p>Waiting for a decision</p>
        </div>
        <div className="metric">
          <span>Stock sync freshness</span>
          <div className="metric-value small-value">
            {s.mapping.syncedAt ? "Synced" : "Unavailable"}
          </div>
          <p>{date(s.mapping.syncedAt)}</p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Activity history</h2>
            <p>
              Recent actions for the selected work. Up to 80 events are shown; download this page to keep a copy.
            </p>
          </div>
        </div>
        {s.audit.length ? (
          <div className="table-wrap">
            <GroupedRecords ctx={ctx} rows={s.audit} type="audit">{(records) => (<table>
              <thead>
                <tr>
                  <th>TIME (IST)</th>
                  <th>ACTOR</th>
                  <th>ACTION</th>
                  <th>DETAILS</th>
                </tr>
              </thead>
              <tbody>
                {records.map((a) => (
                  <tr key={a.id}>
                    <td>{date(a.at)}</td>
                    <td>
                      {s.users?.find((u) => u.id === a.actorId)?.name ??
                        a.actorId}
                    </td>
                    <td>
                      <Badge>{a.action}</Badge>
                    </td>
                    <td>
                      <details>
                        <summary>{a.entityId || "View event"}</summary>
                        <pre>{JSON.stringify(parse(a.data), null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>)}</GroupedRecords>
          </div>
        ) : (
          <Empty
            title="No activity yet"
            detail="Packing approvals, scans, and changes will appear here."
          />
        )}
      </section>
      <section className="panel panel-padding">
        <h2>Tally stock and packed boxes are different</h2>
        <p>
          Scanning records which boxes are loaded. It does not reduce stock in Tally. Accounts must check both records before invoices can be sent.
        </p>
        <p>These are company balances. Selecting work filters the item list, not the Tally balance.</p>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>TALLY BALANCE</th>
              <th>LAST SYNC</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.sku} · {p.name}
                </td>
                <td>
                  {p.bookBalance == null
                    ? "Unavailable"
                    : `${number(p.bookBalance)} ${p.unit}`}
                </td>
                <td>{date(p.syncedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
