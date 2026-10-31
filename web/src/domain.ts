import Decimal from "decimal.js";
import { decodeCompactQr } from "./codes";
export type Line = {
  sku: string;
  quantity: string | number;
  unit: string;
  batch?: string | null;
  godown?: string | null;
};
export type Group = { marking: string; count: number; lines: Line[] };
export type Row = Record<string, any>;
export type State = {
  workflow?: import("./workflow").Workflow;
  orders?: Row[];
  orderProgress?: Row[];
  workLoadedKey?: string;
  workComplete?: boolean;
  workCartonTotal?: number;
  workMissing?: boolean;
  company: Row;
  warehouses: Row[];
  products: Row[];
  customers: Row[];
  manifests: Row[];
  cartons: Row[];
  cartonTotal: number;
  counts: Row[];
  trips: Row[];
  shipments: Row[];
  allocations: Row[];
  loadingSessions: Row[];
  billings: Row[];
  jobs: Row[];
  labels: Row[];
  returns: Row[];
  mapping: Row;
  connectors: Row[];
  audit: Row[];
  users: Row[];
  serverTime: string;
  postingEnabled: boolean;
};
export const parse = <T = any>(value: any): T =>
  typeof value === "string" ? JSON.parse(value) : value;
export function totals(cartons: Row[]) {
  const quantities: Record<string, Decimal> = {};
  for (const c of cartons)
    for (const l of parse<Line[]>(c.lines)) {
      const key = l.sku + "|" + l.unit;
      quantities[key] = (quantities[key] ?? new Decimal(0)).plus(l.quantity);
    }
  return Object.entries(quantities).map(([key, quantity]) => ({
    sku: key.split("|")[0],
    unit: key.split("|")[1],
    quantity: quantity.toString(),
  }));
}
export function parseQr(qr: string, company: string) {
  if (qr.length > 160) throw Error("QR is too long.");
  const compact = decodeCompactQr(qr.trim());
  if (compact) return compact;
  const p = qr.trim().split("|");
  if (
    p.length !== 4 ||
    p[0] !== "K1" ||
    p[1] !== company ||
    !/^CT-[A-Z0-9-]+$/.test(p[2]) ||
    !/^\d+$/.test(p[3]) ||
    Number(p[3]) < 1
  )
    throw Error(
      "Scan a current carton QR for this company. Product barcodes are not carton identities.",
    );
  return { id: p[2], revision: Number(p[3]) };
}
export function csvRows(text: string): string[][] {
  if (text.length > 2 * 1024 * 1024) throw Error("Import exceeds 2 MB.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length) throw Error("Invalid CSV quoting.");
      else quoted = !quoted;
    } else if (!quoted && (ch === "," || ch === "\n" || ch === "\r")) {
      row.push(cell);
      cell = "";
      if (ch !== ",") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        if (row.some((x) => x.length)) rows.push(row);
        row = [];
      }
    } else cell += ch;
  }
  if (quoted) throw Error("Unclosed CSV quote.");
  row.push(cell);
  if (row.some((x) => x.length)) rows.push(row);
  if (rows.length > 10001) throw Error("Import exceeds 10,000 rows.");
  return rows;
}
export function importGroups(rows: string[][], products: Row[]) {
  const errors: string[] = [];
  const groups = new Map<string, Group>();
  const headers = ["group", "cartons", "sku", "quantity", "unit"];
  if (
    !rows.length ||
    headers.some((h, i) => rows[0][i]?.trim().toLowerCase() !== h)
  )
    return {
      groups: [],
      errors: [
        "Headers must be group,cartons,sku,quantity,unit. Individual-carton imports use a unique group with cartons=1.",
      ],
    };
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const [marking, count, sku, q, unit] = cells.map((x) => x.trim());
    const issue = (message: string) => errors.push(`Row ${i + 1}: ${message}`);
    if (cells.length !== 5) {
      issue("Expected exactly five columns.");
      continue;
    }
    if (cells.some((x) => /^[=+@]/.test(x.trim()))) {
      issue("Formulas and executable spreadsheet cells are not allowed.");
      continue;
    }
    if (!marking || marking.length > 80) {
      issue("Physical group marking is required.");
      continue;
    }
    if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 10000) {
      issue("Carton count must be a positive whole number.");
      continue;
    }
    if (
      !/^\d+(\.\d{1,6})?$/.test(q) ||
      new Decimal(q).lte(0) ||
      new Decimal(q).gt(100000000)
    ) {
      issue("Quantity must be positive, up to six decimal places.");
      continue;
    }
    const product = products.find((x) => x.sku === sku);
    if (!product) {
      issue(`Unknown exact SKU ${sku}. Keep leading zeros as text.`);
      continue;
    }
    if (product.unit !== unit) {
      issue(`Unit ${unit} is not mapped for ${sku}.`);
      continue;
    }
    const key = marking + "|" + sku + "|" + unit;
    if (seen.has(key)) {
      issue("Duplicate group/SKU/unit row.");
      continue;
    }
    seen.add(key);
    let group = groups.get(marking);
    if (group && group.count !== Number(count)) {
      issue("A group has inconsistent carton counts.");
      continue;
    }
    if (!group) {
      group = { marking, count: Number(count), lines: [] };
      groups.set(marking, group);
    }
    group.lines.push({ sku, quantity: q, unit });
  }
  if ([...groups.values()].reduce((n, g) => n + g.count, 0) > 10000)
    errors.push("Manifest exceeds 10,000 cartons.");
  if (!groups.size) errors.push("No valid packing groups.");
  return { groups: [...groups.values()], errors };
}
export const safeCsv = (value: unknown) =>
  '"' +
  String(value ?? "")
    .replace(/^[=+\-@\t\r]/, "'$&")
    .replaceAll('"', '""') +
  '"';
export function billNet(quantity: string, rate: string, discount: string) {
  return new Decimal(quantity)
    .times(rate)
    .times(new Decimal(1).minus(new Decimal(discount).div(100)))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
export const number = (n: any) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(
    Number(n ?? 0),
  );
export const money = (n: any) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(n ?? 0),
  );
export const date = (n: any) =>
  n
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(new Date(n))
    : "Not yet";
