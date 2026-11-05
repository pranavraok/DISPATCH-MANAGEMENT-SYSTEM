// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AromazenHome, AromazenDispatch, AromazenInventory, AromazenPacking, AromazenOrderTools, AromazenHistory, AromazenDispatchProgress } from "./aromazen";
import { configureSite } from "./site";
import { workFixture } from "./work-fixture";
import { labelPdf } from "./labels";
import { AromazenPackingPresets, AromazenSuggestions } from "./aromazen-tools";
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

it("opens another order in a separate tab without changing the current selection", () => {
  const ctx=context(); const open=vi.spyOn(window,"open").mockReturnValue(null);
  render(<AromazenOrderTools {...ctx} />);
  fireEvent.click(screen.getByRole("button",{name:"Start new order"}));
  fireEvent.click(screen.getByRole("button",{name:"Open in new tab"}));
  expect(open).toHaveBeenCalledWith(expect.stringContaining("newOrder=1#trips"),"_blank","noopener,noreferrer");
  expect(ctx.selectWork).not.toHaveBeenCalled(); expect(ctx.run).not.toHaveBeenCalled();
});
it("keeps accepted work on the server while starting another order in the same tab", () => {
  const ctx=context(); render(<AromazenOrderTools {...ctx} />);
  fireEvent.click(screen.getByRole("button",{name:"Start new order"}));
  fireEvent.click(screen.getByRole("button",{name:"Keep saved work & start new order"}));
  expect(ctx.selectWork).toHaveBeenCalledWith({kind:"all"});expect(ctx.navigate).toHaveBeenCalledWith("trips");expect(ctx.run).not.toHaveBeenCalled();
});
it("blocks changing orders while a scan result is unresolved", () => {
  const ctx=context();localStorage.setItem("aromazen-uncertain-scan-v2",JSON.stringify({envelope:{requestId:"pending-qa"}}));
  render(<AromazenOrderTools {...ctx} />);expect((screen.getByRole("button",{name:"Start new order"}) as HTMLButtonElement).disabled).toBe(true);
});
it("dispatch progress uses stock-first steps without packing or label generation", () => {
  render(<AromazenDispatchProgress {...context()} />);
  expect(screen.getByRole("navigation",{name:"Dispatch progress"})).toBeTruthy();expect(screen.getByText("Scan cartons")).toBeTruthy();expect(screen.queryByText("Labels")).toBeNull();
});
it("history displays full server totals and filters on the server", async () => {
  const ctx=context();const paths:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async path=>{paths.push(String(path));return new Response(JSON.stringify({total:1,orders:[{order:{id:"history-qa",reference:"QA-HISTORY",customerId:ctx.all.customers[0].id,destination:"Karnataka",createdAt:new Date().toISOString()},shipments:[{shipment:{id:"shipment-qa",loadApproved:false},stage:"Scanning",scannedCartons:240,snapshot:JSON.stringify({lines:[{sku:"SND01",quantity:4800,unit:"bottles"}]}),billTotal:48000}]}]}));}));
  render(<AromazenHistory {...ctx} />);await screen.findByText(/240 cartons scanned/);
  fireEvent.click(screen.getByText("Product quantities in this dispatch"));expect(screen.getByText(/4,800 bottles/)).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox",{name:"Search customer, order or destination"}),{target:{value:"Mysuru"}});
  await waitFor(()=>expect(paths.some(p=>p.includes("search=Mysuru"))).toBe(true));
});

it("does not show misleading order progress on Billing without a selected shipment", () => {
  render(<AromazenDispatchProgress {...context()} requireSelection />);
  expect(screen.queryByRole("navigation", { name: "Dispatch progress" })).toBeNull();
});

it("Home keeps three quick tasks while restoring stock, pending work, recent orders and Tally", async () => {
  const ctx=context();ctx.work={kind:"all"};
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
    inventory:{availableCartons:240,pendingLabels:8,heldCartons:3,loadedCartons:12,products:[{sku:"SND01",name:"Sandal bottles",unit:"bottles",quantity:4800,cartons:240}]},
    pending:{dispatches:{count:7,items:[{shipmentId:"HOME-SHIP",customer:"Mysuru Store",reference:"PO-HOME"}]},bills:{count:2,items:[]},readyInvoices:{count:1,items:[]},tallyIssues:{count:1,items:[]}},
    tally:{status:"Disconnected",invoiceSetupReady:false,lastSync:null},recent:{orders:[{order:{id:"HOME-ORDER",reference:"PO-HOME",state:"Open"},customerName:"Mysuru Store",shipments:[{shipment:{id:"HOME-SHIP",loadApproved:false},stage:"Scanning",scannedCartons:12}]}]},updatedAt:new Date().toISOString()
  }))));
  render(<AromazenHome {...ctx}/>);await screen.findByText("4,800 bottles");
  expect(screen.getByRole("navigation",{name:"Main tasks"}).querySelectorAll("button")).toHaveLength(3);
  expect(screen.getByText("Cartons on hold")).toBeTruthy();expect(screen.getByText("Bills to approve")).toBeTruthy();expect(screen.getByText("Invoices to check")).toBeTruthy();
  expect(screen.getByText("Disconnected")).toBeTruthy();expect(screen.getByRole("heading",{name:"Recent orders"})).toBeTruthy();
  expect(screen.getByText("Help with these numbers").closest("details")?.open).toBe(false);
  fireEvent.click(screen.getAllByRole("button",{name:"Resume"})[0]);expect(ctx.selectWork).toHaveBeenCalledWith({kind:"shipment",id:"HOME-SHIP"});expect(ctx.navigate).toHaveBeenCalledWith("trips");
});

it("reusing a saved packing mix clears manufacturing batches and does not create stock", async () => {
 const ctx=context(),apply=vi.fn();const preset={id:"PRESET-QA",name:"Rose 20",groups:JSON.stringify([{marking:"Rose",count:2,lines:[{sku:"SND01",quantity:20,unit:"bottles",productionBatch:"OLD-LOT"}]}])};
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify([preset]))));
 render(<AromazenPackingPresets ctx={ctx} groups={[]} onApply={apply}/>);fireEvent.click(screen.getByRole("button",{name:"Saved packing mixes"}));fireEvent.click(await screen.findByRole("button",{name:"Use mix"}));
 expect(apply).toHaveBeenCalledWith([{marking:"Rose",count:"2",lines:[{sku:"SND01",quantity:"20",productionBatch:""}]}]);expect(ctx.run).not.toHaveBeenCalled();
});
it("carton assistance is optional and never reserves stock", async () => {
 const ctx=context();vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({complete:false,cartons:[],remaining:[{sku:"SND01",quantity:5,unit:"bottles"}],searchLimited:false}))));
 render(<AromazenSuggestions ctx={ctx} shipment={{warehouseId:"main",customerId:"customer-qa"}}/>);
 expect(screen.queryByRole("button",{name:"Find suitable cartons"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Help me choose cartons"}));fireEvent.change(screen.getByRole("combobox",{name:"Requested product 1"}),{target:{value:"SND01"}});fireEvent.click(screen.getByRole("button",{name:"Find suitable cartons"}));
 await screen.findByText("No whole-carton match found.");expect(ctx.run).not.toHaveBeenCalled();expect(screen.getByText(/Still needed: 5 bottles/)).toBeTruthy();
});
