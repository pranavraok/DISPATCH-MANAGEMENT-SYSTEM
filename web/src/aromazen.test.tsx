// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AromazenDispatch, AromazenInventory, AromazenPacking } from "./aromazen";
import { configureSite } from "./site";
import { workFixture } from "./work-fixture";
import { labelPdf } from "./labels";
import type { Context } from "./main";

vi.mock("./labels", async importOriginal => ({ ...await importOriginal<typeof import("./labels")>(), labelPdf: vi.fn(async () => {}) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); configureSite(null); });
function context(roles = ["Admin"]): Context {
  configureSite({ slug: "aromazon", companyId: "aromazon-india", companyName: "AROMAZEN PVT LTD", shortName: "AROMAZEN", email: "admin@aromazon.test", tagline: "PVT LTD", workflow: "StockFirst" });
  const s = workFixture(); s.company = { id: "aromazon-india", name: "AROMAZEN PVT LTD" }; s.workflow = "StockFirst";
  s.cartons = [{ id: "CT-QA", marking: "Carton A", companyId: s.company.id, manifestId: "PACK-A", state: "PendingLabel", revision: 1, lines: JSON.stringify([{ sku: "SND01", quantity: 20, unit: "bottles" }]) }];
  s.packedInventory = { availableCartons: 0, pendingLabels: 1, heldCartons: 0, loadedCartons: 0, products: [] };
  return { s, all: s, work: { kind: "packing", id: "PACK-A" }, user: { id: "qa-user", name: "QA operator", roles }, sample: false, run: vi.fn(async () => ({})), refresh: vi.fn(async () => {}), navigate: vi.fn(), selectWork: vi.fn(() => true), workflow: "StockFirst" };
}
it("starts with one product and allows more than two products in the same carton group", () => {
  const ctx = context(); render(<AromazenPacking {...ctx} />);
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Add another product to these cartons" }));
  fireEvent.click(screen.getByRole("button", { name: "Add another product to these cartons" }));
  expect(screen.getAllByRole("combobox")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Remove group 1 product 3" })); expect(screen.getAllByRole("combobox")).toHaveLength(2);
});
it("supports another carton group for a different product mix", () => {
  render(<AromazenPacking {...context()} />); fireEvent.click(screen.getByRole("button", { name: "Add another carton group" }));
  expect(screen.getAllByRole("combobox")).toHaveLength(2); expect(screen.getByRole("heading", { name: "Carton group 2" })).toBeTruthy();
});
async function savePlan(ctx: Context) {
  ctx.run = vi.fn(async type => type === "registerStockCartons" ? { id: "PACK-QA", cartons: ctx.s.cartons } : { id: "LABEL-QA", cartons: ctx.s.cartons.map(c => ({ ...c, state: "Available" })) });
  render(<AromazenPacking {...ctx} />);
  fireEvent.change(screen.getByRole("textbox", { name: /^Packing batch name/ }), { target: { value: "QA bottle batch" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "SND01" } });
  fireEvent.click(screen.getByRole("button", { name: "Save carton contents" }));
  await screen.findByRole("button", { name: "Generate QR & add to inventory" });
}
it("saves carton contents before the explicit QR generation action adds inventory", async () => {
  const ctx = context(); await savePlan(ctx);
  expect(ctx.run).toHaveBeenCalledTimes(1); expect(ctx.run).toHaveBeenCalledWith("registerStockCartons", expect.objectContaining({ name: "QA bottle batch", groups: [expect.objectContaining({ count: 1, lines: [expect.objectContaining({ sku: "SND01", quantity: "20" })] })] }));
  fireEvent.click(screen.getByRole("button", { name: "Generate QR & add to inventory" }));
  await screen.findByRole("button", { name: "Print the same QR labels again" });
  expect(ctx.run).toHaveBeenCalledWith("createLabels", expect.objectContaining({ ids: ["CT-QA"] })); expect(labelPdf).toHaveBeenCalled();
});
it("reprinting reuses the saved carton IDs instead of registering new cartons", async () => {
  const ctx = context(); await savePlan(ctx);
  fireEvent.click(screen.getByRole("button", { name: "Generate QR & add to inventory" }));
  fireEvent.click(await screen.findByRole("button", { name: "Print the same QR labels again" }));
  await waitFor(() => expect(ctx.run).toHaveBeenCalledTimes(3));
  const calls = vi.mocked(ctx.run).mock.calls;
  expect(calls.filter(c => c[0] === "registerStockCartons")).toHaveLength(1);
  expect(calls.filter(c => c[0] === "createLabels").map(c => c[1].ids)).toEqual([["CT-QA"], ["CT-QA"]]);
});
it("inventory contains no first-scan or receiving-approval controls", () => {
  render(<AromazenInventory {...context(["PackingClerk"])} />);
  expect(screen.queryByRole("button", { name: /First scan|Approve into inventory/ })).toBeNull();
  expect(screen.getByText("Generate its QR to add it to inventory.")).toBeTruthy();
});
it("product balances use the authoritative full-inventory summary rather than visible carton rows", () => {
  const ctx = context(); ctx.all.packedInventory = { availableCartons: 201, pendingLabels: 1, heldCartons: 0, loadedCartons: 0, products: [{ sku: "SND01", unit: "bottles", quantity: 4020, cartons: 201 }] };
  render(<AromazenInventory {...ctx} />); expect(screen.getByText("4,020 bottles")).toBeTruthy();
  expect(screen.getAllByText("201").length).toBeGreaterThan(0);
});
it("contents lookup is a read-only request and never moves inventory", async () => {
  const ctx = context(); const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async path => { paths.push(String(path)); return new Response(JSON.stringify({ carton: ctx.s.cartons[0], lines: [] })); }));
  render(<AromazenInventory {...ctx} />); fireEvent.change(screen.getByRole("textbox", { name: /^Carton QR/ }), { target: { value: "K1|aromazon-india|CT-QA|1" } });
  fireEvent.click(screen.getByRole("button", { name: "Look up contents" })); await screen.findByText("Contents lookup only. Inventory was not changed.");
  expect(paths).toHaveLength(1); expect(paths[0]).toContain("/api/cartons/lookup?qr="); expect(ctx.run).not.toHaveBeenCalled();
});
it("management can inspect inventory but cannot generate stock labels", () => {
  render(<AromazenInventory {...context(["MD"])} />); fireEvent.click(screen.getByRole("checkbox", { name: "Select CT-QA" }));
  expect((screen.getByRole("button", { name: "Generate / print selected QR labels" }) as HTMLButtonElement).disabled).toBe(true);
});
it("dispatch selects a customer before opening the scanning shipment", async () => {
  const ctx = context(); ctx.work = { kind: "all" }; ctx.run = vi.fn(async () => ({ id: "SHIP-NEW" }));
  render(<AromazenDispatch {...ctx} />);
  fireEvent.change(screen.getByRole("combobox", { name: /^Customer/ }), { target: { value: "customer-one" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^Order/ }), { target: { value: "PO-QA-001" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^Delivery/ }), { target: { value: "QA address, Karnataka" } });
  fireEvent.click(screen.getByRole("button", { name: "Select customer & start dispatch" }));
  await waitFor(() => expect(ctx.run).toHaveBeenCalledWith("beginStockDispatch", expect.objectContaining({ customerId: "customer-one", reference: "PO-QA-001" })));
  expect(ctx.selectWork).toHaveBeenCalledWith({ kind: "shipment", id: "SHIP-NEW" });
});
