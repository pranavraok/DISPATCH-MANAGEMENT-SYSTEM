import { api } from "./api";
import { useState, type FormEvent } from "react";
import {
  Plus,
  Check,
  Printer,
  FileDown,
  Upload,
  ArrowUpRight,
  Search,
  ShieldCheck,
  AlertTriangle,
  Truck,
  ScanLine,
  RefreshCw,
} from "lucide-react";
import { Badge, Empty, Field, Modal, type Context } from "./main";
import {
  type Row,
  type Group,
  type Line,
  parse,
  number,
  money,
  date,
  totals,
  csvRows,
  importGroups,
  safeCsv,
} from "./domain";
import { labelPdf, packingPdf, download } from "./labels";
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
export function PackingScreen(ctx: Context) {
  const { s } = ctx;
  const [edit, setEdit] = useState<Row | null>(null),
    [importing, setImporting] = useState(false),
    [confirm, setConfirm] = useState<Row | null>(null),
    [checked, setChecked] = useState(false);
  return (
    <>
      <Heading
        eyebrow="ALREADY PACKED. READY TO REGISTER."
        title="Packed registration"
        detail="Describe actual cartons. A supervisor approves the physical groups."
        action={
          <div className="button-row">
            <button
              className="secondary"
              disabled={!may(ctx, "PackingClerk", "PackingSupervisor")}
              onClick={() => setImporting(true)}
            >
              <Upload size={16} />
              Import CSV / Excel
            </button>
            <button
              className="primary"
              disabled={!may(ctx, "PackingClerk", "PackingSupervisor")}
              onClick={() => setEdit({})}
            >
              <Plus size={17} />
              New manifest
            </button>
          </div>
        }
      />
      <div className="notice">
        <ShieldCheck size={18} />
        Packing groups speed up data entry. Approval creates a different
        immutable identity for every physical carton.
      </div>
      <section className="panel">
        {s.manifests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>MANIFEST</th>
                  <th>CONTENTS</th>
                  <th>CARTONS</th>
                  <th>STATE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {s.manifests.map((m) => {
                  const groups = parse<Group[]>(m.groups);
                  return (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.name}</strong>
                        <small>
                          {m.id} · Revision {m.version}
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No packed manifests yet"
            detail="Start with the actual packed groups or import a validated spreadsheet."
          />
        )}
      </section>
      {edit && (
        <PackedEditor ctx={ctx} manifest={edit} close={() => setEdit(null)} />
      )}
      {importing && (
        <ImportDialog ctx={ctx} close={() => setImporting(false)} />
      )}
      {confirm && (
        <Modal
          title="Approve physical packed contents"
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
                  Group {g.marking} · {g.count} cartons
                </strong>
                <p>
                  {g.lines
                    .map((l) => `${l.quantity} ${l.unit} ${l.sku} per carton`)
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
              )
                setConfirm(null);
            }}
          >
            <Check size={17} />
            Approve & create {groupTotal(parse(confirm.groups))} unique cartons
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
  close: () => void;
}) {
  const [name, setName] = useState(m.name ?? ""),
    [customer, setCustomer] = useState(m.customerId ?? ""),
    [notes, setNotes] = useState(m.notes ?? ""),
    [groups, setGroups] = useState<Group[]>(
      m.groups
        ? parse(m.groups)
        : [
            {
              marking: "A",
              count: 1,
              lines: [
                {
                  sku: ctx.s.products[0]?.sku ?? "",
                  quantity: "100",
                  unit: ctx.s.products[0]?.unit ?? "packets",
                },
              ],
            },
          ],
    );
  const readonly =
    m.state === "Approved" || !may(ctx, "PackingClerk", "PackingSupervisor");
  function change(i: number, key: string, value: any) {
    setGroups((p) => p.map((g, j) => (j === i ? { ...g, [key]: value } : g)));
  }
  return (
    <Modal
      title={m.id ? "Packed contents" : "Register a packed manifest"}
      close={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = {
            name,
            warehouseId: m.warehouseId ?? ctx.s.warehouses[0]?.id,
            customerId: customer || null,
            notes,
            groups,
            ...(m.id ? { id: m.id, version: m.version } : {}),
          };
          if (await action(ctx, "saveManifest", data)) close();
        }}
      >
        <Field label="Manifest name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={3}
            required
            disabled={readonly}
          />
        </Field>
        <Field label="Customer assignment">
          <select
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            disabled={readonly}
          >
            <option value="">General packed stock · allocate later</option>
            {ctx.s.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="group-editors">
          {groups.map((g, i) => (
            <section className="group-editor" key={i}>
              <div className="form-grid">
                <Field label="Physical group marking">
                  <input
                    value={g.marking}
                    onChange={(e) => change(i, "marking", e.target.value)}
                    required
                    disabled={readonly}
                  />
                </Field>
                <Field label="Number of cartons">
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
                    {ctx.s.products.map((p) => (
                      <option value={p.sku} key={p.id}>
                        {p.sku} · {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Quantity per carton"
                    type="text"
                    inputMode="decimal"
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
                  <span>{l.unit} / carton</span>
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
              {!readonly && (
                <div className="button-row">
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      change(i, "lines", [
                        ...g.lines,
                        {
                          sku: ctx.s.products[0].sku,
                          quantity: "1",
                          unit: ctx.s.products[0].unit,
                        },
                      ])
                    }
                  >
                    + Add another product to each carton
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
        {!readonly && (
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
                      sku: ctx.s.products[0].sku,
                      quantity: "100",
                      unit: ctx.s.products[0].unit,
                    },
                  ],
                },
              ])
            }
          >
            + Add packing group
          </button>
        )}
        <Field label="Supervisor notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={readonly}
          />
        </Field>
        <div className="form-summary">
          <strong>{number(groupTotal(groups))} cartons described</strong>
          <span>Contents are recorded per carton.</span>
        </div>
        {!readonly && <button className="primary wide">Save draft</button>}
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
    <Modal title="Import packed groups or individual cartons" close={close}>
      <p>
        Use one row per group and product. Mixed cartons share the same group
        and carton count. For unique contents, use a unique group with cartons =
        1.
      </p>
      <button
        className="secondary"
        onClick={() => download("packed-group-template.csv", template)}
      >
        <FileDown size={16} />
        Download template
      </button>
      <Field label="Manifest name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="upload-zone">
        <Upload size={25} />
        <strong>Choose a CSV or Excel workbook</strong>
        <span>2 MB maximum · 10,000 rows · exact SKU and unit mapping</span>
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
              cartons
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
                    {g.marking} · {g.count} cartons
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
              !may(ctx, "PackingClerk", "PackingSupervisor")
            }
            onClick={async () => {
              if (
                await action(ctx, "importManifest", {
                  name,
                  warehouseId: ctx.s.warehouses[0]?.id,
                  customerId: null,
                  notes: "Validated import. No partial import performed.",
                  groups: preview.groups,
                })
              )
                close();
            }}
          >
            Commit entire import as draft
          </button>
        </>
      )}
    </Modal>
  );
}
export function CartonScreen(ctx: Context) {
  const { s } = ctx;
  const [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [qr, setQr] = useState(""),
    [physical, setPhysical] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Row | null>(null);
  const rows = s.cartons.filter((c) =>
    (c.id + " " + c.marking + " " + c.state)
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
        eyebrow="ONE PHYSICAL CARTON. ONE UNIQUE ID."
        title="Cartons & labels"
        detail="Print in one batch, attach to the right boxes and scan to verify."
        action={
          <div className="button-row">
            <button
              className="secondary"
              disabled={!rows.length}
              onClick={() => print(true)}
            >
              A4 test page
            </button>
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
      <div className="notice">
        A4 trial layout: 90 × 50 mm labels, 34 mm QR, 2 columns × 5 rows. Print
        at 100% / actual size. Test dimensions on your printer first.
      </div>
      {error && <div className="notice error">{error}</div>}
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search carton, group or status"
            />
          </div>
          <span>
            {s.cartons.length} of {s.cartonTotal} cartons shown
          </span>
          <button
            className="secondary small"
            disabled={
              !chosen.length || !may(ctx, "PackingClerk", "PackingSupervisor")
            }
            onClick={() => {
              if (
                confirm(
                  "Confirm labels are physically attached to the matching selected boxes.",
                )
              )
                void action(ctx, "attachLabels", {
                  ids: selected,
                  physicalConfirmed: true,
                });
            }}
          >
            Confirm attached
          </button>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label="Select current page"
                      type="checkbox"
                      checked={
                        rows.length > 0 &&
                        rows.every((c) => selected.includes(c.id))
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? rows.map((c) => c.id) : [],
                        )
                      }
                    />
                  </th>
                  <th>CARTON / GROUP</th>
                  <th>CONTENTS PER CARTON</th>
                  <th>PHYSICAL CHECK</th>
                  <th>STATE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
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
                      <strong className="mono">{c.id}</strong>
                      <small>
                        Group {c.marking} · Label r{c.revision}
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
                          ? "Verified"
                          : c.attached
                            ? "Attached · verify next"
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
                                      : "holding this carton"),
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
            </table>
          </div>
        ) : (
          <Empty
            title="No carton identities yet"
            detail="Approve a packed manifest to create its unique physical carton IDs."
          />
        )}
      </section>
      <section className="panel verification-panel">
        <div>
          <h2>Scan attachment & contents verification</h2>
          <p>
            A supervisor checks the actual box. Printed data alone does not
            prove sealed contents.
          </p>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await action(ctx, "verifyCarton", {
                qr,
                physicalConfirmed: physical,
              })
            )
              setQr("");
          }}
        >
          <input
            aria-label="Verification QR"
            placeholder="Scan current carton QR and press Enter"
            value={qr}
            onChange={(e) => setQr(e.target.value)}
            maxLength={160}
            required
          />
          <label className="check-field">
            <input
              type="checkbox"
              checked={physical}
              onChange={(e) => setPhysical(e.target.checked)}
            />
            I checked the physical identity and actual contents.
          </label>
          <button
            className="primary"
            disabled={!physical || !may(ctx, "PackingSupervisor")}
          >
            <ShieldCheck size={16} />
            Verify this carton
          </button>
        </form>
      </section>
      {s.labels.length > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Label print jobs</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>JOB</th>
                <th>PREPARED</th>
                <th>STATUS</th>
                <th>RECORD PHYSICAL PRINT RESULT</th>
              </tr>
            </thead>
            <tbody>
              {s.labels.map((j) => (
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
          </table>
        </section>
      )}
      {history && (
        <Modal
          title="Carton identity & contents"
          close={() => setHistory(null)}
        >
          <code>{`K1|${history.companyId}|${history.id}|${history.revision}`}</code>
          <pre>
            {JSON.stringify(
              { ...history, lines: parse(history.lines) },
              null,
              2,
            )}
          </pre>
          <p>
            Full historical events are available in Reports & audit. Unloaded
            content corrections require a new label revision and physical
            reverification.
          </p>
        </Modal>
      )}
    </>
  );
}
export function TripsScreen(ctx: Context) {
  const { s } = ctx;
  const [creating, setCreating] = useState(false),
    [allocating, setAllocating] = useState<string | null>(null),
    [vehicle, setVehicle] = useState(""),
    [driver, setDriver] = useState(""),
    [transporter, setTransporter] = useState(""),
    [customer, setCustomer] = useState(s.customers[0]?.id ?? ""),
    [destination, setDestination] = useState("Mysuru, Karnataka"),
    [ids, setIds] = useState<string[]>([]);
  return (
    <>
      <Heading
        eyebrow="CUSTOMERS, CARTONS AND VEHICLES"
        title="Dispatch trips"
        detail="Partial consignments stay separate. One vehicle can carry several customer shipments."
        action={
          <button
            className="primary"
            disabled={!may(ctx, "DispatchSupervisor")}
            onClick={() => setCreating(true)}
          >
            <Plus size={17} />
            New vehicle trip
          </button>
        }
      />
      {!s.trips.length ? (
        <section className="panel">
          <Empty
            title="No vehicle trips yet"
            detail="Create a trip, then reserve the verified cartons for each customer."
          />
        </section>
      ) : (
        s.trips.map((t) => (
          <section className="panel trip-card" key={t.id}>
            <div className="panel-heading">
              <div className="trip-title">
                <span className="trip-icon">
                  <Truck size={25} />
                </span>
                <div>
                  <h2>{t.vehicle}</h2>
                  <p>
                    {t.driver} · {t.transporter || "Transporter not set"} ·{" "}
                    {t.id}
                  </p>
                </div>
                <Badge tone={t.state === "Open" ? "sage" : "neutral"}>
                  {t.state}
                </Badge>
              </div>
              <div className="button-row">
                <button
                  className="secondary small"
                  disabled={
                    t.state !== "Open" || !may(ctx, "DispatchSupervisor")
                  }
                  onClick={() => {
                    setAllocating(t.id);
                    setIds([]);
                  }}
                >
                  Allocate customer shipment
                </button>
                <button
                  className="primary small"
                  disabled={
                    t.state !== "Open" || !may(ctx, "DispatchSupervisor")
                  }
                  onClick={() => {
                    if (
                      confirm(
                        "Confirm physical departure review. All shipment invoice and document gates must pass.",
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
            </div>
            {s.shipments
              .filter((x) => x.tripId === t.id)
              .map((sh) => {
                const a = s.allocations.filter(
                    (x) => x.shipmentId === sh.id && x.active,
                  ),
                  loaded = a.filter((x) => x.state === "Loaded").length;
                return (
                  <div className="shipment-row" key={sh.id}>
                    <div>
                      <h3>
                        {s.customers.find((c) => c.id === sh.customerId)?.name}
                      </h3>
                      <p>{sh.destination}</p>
                      <small>{sh.id}</small>
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
                        onClick={() => ctx.navigate("loading")}
                      >
                        <ScanLine size={15} />
                        Load
                      </button>
                      <button
                        className="secondary small"
                        disabled={
                          sh.loadApproved || !may(ctx, "DispatchSupervisor")
                        }
                        onClick={() => {
                          if (
                            confirm(
                              "I reviewed the exact allocated cartons and physical load.",
                            )
                          )
                            void action(ctx, "approveLoad", {
                              id: sh.id,
                              physicalConfirmed: true,
                            });
                        }}
                      >
                        Approve load
                      </button>
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
                                "Reason to cancel this unposted shipment and release reserved cartons",
                              );
                              if (reason)
                                void action(ctx, "releaseShipment", {
                                  id: sh.id,
                                  reason,
                                });
                            }}
                          >
                            Cancel & release reservation
                          </button>
                        )}
                    </div>
                  </div>
                );
              })}
            {!s.shipments.some((x) => x.tripId === t.id) && (
              <p className="panel-padding muted">
                Add the first customer shipment to this vehicle.
              </p>
            )}
          </section>
        ))
      )}
      {creating && (
        <Modal title="Create vehicle trip" close={() => setCreating(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(ctx, "createTrip", {
                  vehicle,
                  driver,
                  transporter,
                })
              )
                setCreating(false);
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
          title="Reserve verified cartons for a customer"
          close={() => setAllocating(null)}
        >
          <Field label="Customer">
            <select
              value={customer}
              onChange={(e) => {
                setCustomer(e.target.value);
                setIds([]);
              }}
            >
              {s.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Delivery destination">
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </Field>
          <p>
            Choose the exact cartons leaving in this shipment. Remaining cartons
            stay available for another day or vehicle.
          </p>
          <div className="allocation-list">
            {s.cartons
              .filter(
                (c) =>
                  c.state === "Available" &&
                  c.verified &&
                  !c.held &&
                  (!c.customerId || c.customerId === customer),
              )
              .map((c) => (
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
              ))}
          </div>
          <button
            className="primary wide"
            disabled={!ids.length}
            onClick={async () => {
              if (
                await action(ctx, "allocate", {
                  tripId: allocating,
                  customerId: customer,
                  destination,
                  ids,
                })
              )
                setAllocating(null);
            }}
          >
            Reserve {ids.length} cartons
          </button>
        </Modal>
      )}
    </>
  );
}

export function BillingScreen(ctx: Context) {
  const { s } = ctx;
  const [editing, setEditing] = useState<Row | null>(null);
  return (
    <>
      <Heading
        eyebrow="REVIEW FIRST. POST ONCE."
        title="Billing & Tally"
        detail="Each approved customer shipment has its own versioned billing document."
      />
      <div className="notice amber">
        <AlertTriangle size={18} />
        <div>
          <strong>Live posting is blocked.</strong> Exact company identity,
          stock mappings, approved voucher XML, taxes, freight and reliable
          readback must be validated in an isolated Tally test company. Draft
          totals below exclude unresolved taxes.
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Customer billing documents</h2>
            <p>Loading approval is required before pricing.</p>
          </div>
        </div>
        {s.shipments.filter((sh) => sh.state !== "Cancelled").length ? (
          <div className="table-wrap">
            <table>
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
                {s.shipments
                  .filter((sh) => sh.state !== "Cancelled")
                  .map((sh) => {
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
                          {bill ? "r" + bill.revision : "No draft"}
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
                                      "I reviewed this exact billing revision and the selected customer shipment.",
                                    )
                                  )
                                    void action(ctx, "approveBilling", {
                                      id: bill.id,
                                      physicalConfirmed: true,
                                    });
                                }}
                              >
                                Approve r{bill.revision}
                              </button>
                            )}
                            {bill?.approved && !sh.invoiceJobId && (
                              <button
                                className="secondary small"
                                disabled={!may(ctx, "Billing")}
                                onClick={() =>
                                  action(ctx, "queueInvoice", { id: sh.id })
                                }
                              >
                                Create posting job
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No customer billing documents yet"
            detail="Allocate cartons, verify loading and approve the physical load to begin billing."
          />
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Posting jobs & reconciliation</h2>
            <p>A lost or uncertain response never means a safe retry.</p>
          </div>
          <Badge tone="amber">Guarded</Badge>
        </div>
        {s.jobs.length ? (
          <table>
            <thead>
              <tr>
                <th>OPERATION</th>
                <th>STATE</th>
                <th>DETAIL</th>
                <th>VOUCHER</th>
              </tr>
            </thead>
            <tbody>
              {s.jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <strong className="mono">{j.id.slice(0, 16)}</strong>
                    <small>{j.shipmentId}</small>
                  </td>
                  <td>
                    <Badge tone={j.state === "Confirmed" ? "sage" : "amber"}>
                      {j.state}
                    </Badge>
                  </td>
                  <td>{j.detail}</td>
                  <td>{j.voucherReference ?? "No confirmed voucher"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title="No posting attempts"
            detail="Approved billing can create a durable blocked job for review. No Tally Create call is enabled in this stage."
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
  const s = ctx.s;
  const ids = s.allocations
    .filter((a) => a.shipmentId === shipment.id && a.active)
    .map((a) => a.cartonId);
  const cartons = s.cartons.filter((c) => ids.includes(c.id));
  const ts = totals(cartons);
  const previous = s.billings.find(
    (b) =>
      b.shipmentId === shipment.id && b.revision === shipment.billingVersion,
  );
  const previousData = previous ? parse(previous.snapshot) : null;
  const [rates, setRates] = useState(
      ts.map((t) => ({
        sku: t.sku,
        rate: String(
          previousData?.lines.find((l: Row) => l.sku === t.sku)?.rate ?? "",
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
    [terms, setTerms] = useState(previousData?.terms ?? "");
  return (
    <Modal title="Review billing revision" close={close}>
      <div className="notice amber">
        Rates from Tally are currently unavailable. Enter authorised rates with
        a reason. No actual GST rate or freight tax treatment is assumed.
      </div>
      {cartons.length !== ids.length && (
        <div className="notice error">
          Some allocated carton details are outside the current page. Load
          complete shipment details before billing. Server validation will
          reject an incomplete rate set.
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await action(ctx, "saveBilling", {
              shipmentId: shipment.id,
              rates,
              freight,
              otherCharges: charges,
              reason,
              terms,
              version: shipment.billingVersion,
            })
          )
            close();
        }}
      >
        {rates.map((r, i) => (
          <section className="group-editor" key={r.sku}>
            <strong>
              {r.sku} · {ts[i].quantity} {ts[i].unit}
            </strong>
            <div className="form-grid">
              <Field label="Rate per recorded unit (₹)">
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
        <Field label="Terms">
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} />
        </Field>
        <Field label="Reason / source for pricing and changes">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={3}
            required
          />
        </Field>
        <button
          className="primary wide"
          disabled={cartons.length !== ids.length}
        >
          Save new revision · invalidate earlier billing approval
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
  return (
    <>
      <Heading
        eyebrow="CONNECTED, WITH THE RIGHT BOUNDARIES"
        title="Settings & connections"
        detail="Scanner PC → cloud application → outbound connector on the separate Tally PC."
      />
      <div className="setup-steps">
        {[
          ["1", "Pair connector", "Install beside Tally. Outbound HTTPS only."],
          [
            "2",
            "Confirm test company",
            "Exact identity. No active-company fallback.",
          ],
          [
            "3",
            "Map & validate",
            "Export accountant-approved sample vouchers.",
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
          <h2>Accountant mapping draft</h2>
          <p>Configuration changes are audited and invalidate the contract.</p>
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
                reason: "Accountant mapping draft update",
              });
            }}
          >
            <Field label="Exact isolated TEST company name">
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
              <input
                value={ledger}
                onChange={(e) => setLedger(e.target.value)}
              />
            </Field>
            <Field label="Pattern, unit, GST & freight notes">
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
              Save mapping draft
            </button>
            <div className="notice amber">
              This stage cannot certify a posting contract. Live Tally posting
              remains disabled.
            </div>
          </form>
        </section>
        <section className="panel panel-padding">
          <h2>Windows Tally connectors</h2>
          <p>Secrets remain on the server and in Windows-protected storage.</p>
          <button
            className="secondary"
            disabled={!may(ctx) || expectedCompany.length < 3}
            onClick={async () => {
              const r = await action(ctx, "pairConnector", {
                name: "Tally test PC",
                expectedCompany,
              });
              if (r) setPair(r);
            }}
          >
            <Plus size={16} />
            Pair exact test company
          </button>
          {s.connectors.map((c) => (
            <div className="connector-card" key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <Badge tone={c.revoked ? "red" : "amber"}>
                  {c.revoked ? "Revoked" : "Test scope"}
                </Badge>
              </div>
              <p>{c.expectedCompany}</p>
              <small>Last heartbeat: {date(c.lastSeen)}</small>
              <p>
                {parse(c.diagnostics).detail ??
                  "Waiting for outbound heartbeat."}
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
                Revoke credential
              </button>
            </div>
          ))}
          {!s.connectors.length && (
            <Empty
              title="No connector paired"
              detail="Tally runs on another PC. This application never calls the factory's localhost from the cloud."
            />
          )}
          <div className="notice">
            D-5015 generic HID input cannot report battery, radio signal or
            remote decode tones. Use a nearby speaker and the explicit audio
            test.
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Users & roles</h2>
            <p>Permissions are enforced by the API.</p>
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
    <Modal title="Create workspace user" close={close}>
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
              {r === "MD" ? "MD · Read-only" : r}
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
    [lines, setLines] = useState("[]"),
    [error, setError] = useState("");
  return (
    <>
      <Heading
        eyebrow="HISTORY STAYS INTACT"
        title="Returns & corrections"
        detail="Post-departure returns are quarantined. Pre-departure changes use Unload."
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
        Original outbound identities stay departed. Return receipt, QC,
        accounting credit and stock restock are separate decisions.
      </div>
      <section className="panel">
        {s.returns.length ? (
          <table>
            <thead>
              <tr>
                <th>ORIGINAL CARTON</th>
                <th>RETURNED CONTENTS</th>
                <th>QC STATE</th>
                <th>ACCOUNTING</th>
              </tr>
            </thead>
            <tbody>
              {s.returns.map((r) => (
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
                            const reason = prompt("QC decision reason");
                            if (reason)
                              void action(ctx, "returnDisposition", {
                                id: r.id,
                                disposition,
                                reason,
                              });
                          }}
                        >
                          {disposition}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>{r.accountingStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title="No returned cartons"
            detail="Record actual returned quantities against an original departed shipment and carton."
          />
        )}
      </section>
      {open && (
        <Modal
          title="Record full or partial physical return"
          close={() => setOpen(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                setError("");
                const returned = parse(lines);
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
            <Field label="Original departed shipment">
              <select
                value={shipmentId}
                onChange={(e) => setShipment(e.target.value)}
                required
              >
                <option value="">Select original shipment</option>
                {s.shipments
                  .filter((sh) => sh.state === "Departed")
                  .map((sh) => (
                    <option key={sh.id} value={sh.id}>
                      {sh.id}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Original carton ID">
              <input
                value={cartonId}
                onChange={(e) => {
                  setCarton(e.target.value);
                  const c = s.cartons.find((c) => c.id === e.target.value);
                  if (c) setLines(JSON.stringify(parse(c.lines), null, 2));
                }}
                required
              />
            </Field>
            <Field label="Actual returned line quantities (editable JSON)">
              <textarea
                className="code-input"
                rows={7}
                value={lines}
                onChange={(e) => setLines(e.target.value)}
              />
            </Field>
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
                <option>Uninspected</option>
                <option>Sealed</option>
                <option>Opened</option>
                <option>Damaged</option>
              </select>
            </Field>
            {error && <div className="notice error">{error}</div>}
            <button className="primary wide">
              Record & quarantine returned goods
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function ReportsScreen(ctx: Context) {
  const { s } = ctx;
  return (
    <>
      <Heading
        eyebrow="TRACEABLE FROM PACKING TO DEPARTURE"
        title="Reports & audit"
        detail="Append-only history of approvals, reservations, scans and corrections."
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
            Export current audit page
          </button>
        }
      />
      <div className="metrics">
        <div className="metric">
          <span>Registered cartons</span>
          <div className="metric-value">{s.cartonTotal}</div>
          <p>Operational identities</p>
        </div>
        <div className="metric">
          <span>Trips departed</span>
          <div className="metric-value">
            {s.trips.filter((x) => x.state === "Departed").length}
          </div>
          <p>Current query window</p>
        </div>
        <div className="metric">
          <span>Returns quarantined</span>
          <div className="metric-value">
            {s.returns.filter((x) => x.state === "Quarantine").length}
          </div>
          <p>Awaiting authorised disposition</p>
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
            <h2>Operational audit trail</h2>
            <p>
              Most recent 80 events. Export is protected against spreadsheet
              formula injection.
            </p>
          </div>
        </div>
        {s.audit.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>TIME (IST)</th>
                  <th>ACTOR</th>
                  <th>ACTION</th>
                  <th>DETAILS</th>
                </tr>
              </thead>
              <tbody>
                {s.audit.map((a) => (
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
            </table>
          </div>
        ) : (
          <Empty
            title="Audit events will appear here"
            detail="Approvals, scans and corrections are saved transactionally with their audit event."
          />
        )}
      </section>
      <section className="panel panel-padding">
        <h2>Accounting stock ≠ packed physical availability</h2>
        <p>
          Scanning changes operational loading state. It never creates a Tally
          stock deduction. Last synced Tally balance, pending movements and
          accountant activity must be reconciled before enabling live posting.
        </p>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>TALLY BALANCE</th>
              <th>LAST SYNC</th>
            </tr>
          </thead>
          <tbody>
            {s.products.map((p) => (
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
