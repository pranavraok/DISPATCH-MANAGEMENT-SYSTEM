// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, type Context } from "./main";
import { PackingScreen } from "./screens";
import { sampleState } from "./sample";
import { readWorkstation } from "./workstation";
import type { Workflow } from "./workflow";

const user = { id: "dual-user", companyId: "demo", name: "Workflow tester", roles: ["Admin"] };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function fixture(workflow: Workflow) {
  const s = sampleState();
  return { ...s, workflow, manifests: [], cartons: [], counts: [], trips: [], shipments: [], allocations: [], loadingSessions: [], orders: [{ id: workflow + "-order", reference: workflow === "OrderFirst" ? "CUSTOM-PO" : "STOCK-PO", customerId: s.customers[0].id, warehouseId: s.warehouses[0].id, destination: "Fictional delivery site", expectedCartons: 2, lines: "[]", state: "Open" }] };
}
beforeEach(() => { localStorage.clear(); window.history.replaceState(null, "", "/"); });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
function server() {
  const fetcher = vi.fn(async (path: string) => {
    if (path === "/api/auth/me") return json({ user, csrf: "test" });
    if (path.startsWith("/api/state")) return json(fixture(path.includes("OrderFirst") ? "OrderFirst" : "StockFirst"));
    throw Error("Unexpected request: " + path);
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function choose(workflow: Workflow) {
  const title = workflow === "StockFirst" ? "Pack before order" : "Order first";
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }));
  await screen.findByRole("heading", { name: title });
}
function go(label: string) { fireEvent.click(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: label })); }

describe("two workflows with shared setup", () => {
  it("opens a choice after sign-in and keeps each workflow dashboard and orders separate", async () => {
    server(); render(<App />);
    await screen.findByRole("heading", { name: "How are we preparing this dispatch?" });
    await choose("StockFirst"); go("Orders"); await screen.findByRole("heading", { name: "STOCK-PO" }); expect(screen.queryByText("CUSTOM-PO")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Switch workflow/ })); await choose("OrderFirst"); go("Orders");
    await screen.findByRole("heading", { name: "CUSTOM-PO" }); expect(screen.queryByText("STOCK-PO")).toBeNull();
    expect(window.location.search).toContain("workflow=OrderFirst");
  });
  it("restores the selected workflow and page on refresh without asking for login", async () => {
    const requests = server(); window.history.replaceState(null, "", "/?workflow=OrderFirst#orders");
    const app = render(<App />); await screen.findByRole("heading", { name: "CUSTOM-PO" }); app.unmount(); render(<App />);
    await screen.findByRole("heading", { name: "CUSTOM-PO" }); expect(screen.queryByLabelText("Password")).toBeNull(); expect(requests.mock.calls.some(([path]) => path === "/api/auth/login")).toBe(false);
  });
  it("uses the same saved scanner workstation and Tally setup in both workflows", async () => {
    server(); render(<App />); await choose("StockFirst"); go("Shared settings");
    fireEvent.change(await screen.findByLabelText("Scanner workstation name"), { target: { value: "FACTORY-SCANNER-01" } }); fireEvent.click(screen.getByRole("button", { name: "Save workstation" }));
    expect(readWorkstation("demo").station).toBe("FACTORY-SCANNER-01");
    fireEvent.click(screen.getByRole("button", { name: /Switch workflow/ })); await choose("OrderFirst"); go("Shared settings");
    expect((await screen.findByLabelText("Scanner workstation name") as HTMLInputElement).value).toBe("FACTORY-SCANNER-01");
    expect(screen.getAllByRole("heading", { name: "Tally PC connections" })).toHaveLength(1);
  });
  it("prevents a workflow switch while a scan result is uncertain", async () => {
    server(); window.history.replaceState(null, "", "/?workflow=OrderFirst"); render(<App />); await screen.findByRole("heading", { name: "Order first" });
    localStorage.setItem("electro-group-uncertain-scan-v1", JSON.stringify({ envelope: { requestId: "uncertain", data: { workflow: "OrderFirst" } } }));
    fireEvent.click(screen.getByRole("button", { name: /Switch workflow/ }));
    expect(await screen.findByRole("alert")).toBeTruthy(); expect(window.location.search).toContain("OrderFirst");
  });
  it("requires a received order before saving order-first packing and links its customer", async () => {
    const s = fixture("OrderFirst"), run = vi.fn(async () => ({ id: "PACK-NEW" }));
    const ctx: Context = { s, all: s, workflow: "OrderFirst", work: { kind: "all" }, selectWork: vi.fn(() => true), user, sample: false, run, refresh: vi.fn(), navigate: vi.fn() };
    render(<PackingScreen {...ctx} />); fireEvent.click(screen.getByRole("button", { name: "New packing list" }));
    const dialog = screen.getByRole("dialog"); expect((within(dialog).getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Customer order"), { target: { value: "OrderFirst-order" } }); fireEvent.change(within(dialog).getByLabelText("Packing list name"), { target: { value: "Customer packing" } });
    fireEvent.submit(within(dialog).getByLabelText("Packing list name").closest("form")!);
    await waitFor(() => expect(run).toHaveBeenCalledWith("saveManifest", expect.objectContaining({ orderId: "OrderFirst-order", customerId: s.customers[0].id })));
  });
  it("keeps pre-order packing unassigned to a customer", async () => {
    const s = fixture("StockFirst"), run = vi.fn(async () => ({ id: "PACK-STOCK" }));
    const ctx: Context = { s, all: s, workflow: "StockFirst", work: { kind: "all" }, selectWork: vi.fn(() => true), user, sample: false, run, refresh: vi.fn(), navigate: vi.fn() };
    render(<PackingScreen {...ctx} />); fireEvent.click(screen.getByRole("button", { name: "New packing list" }));
    expect(screen.queryByLabelText("Customer order")).toBeNull(); expect(screen.queryByLabelText("Customer")).toBeNull();
    fireEvent.change(screen.getByLabelText("Packing list name"), { target: { value: "Stock without order" } }); fireEvent.submit(screen.getByLabelText("Packing list name").closest("form")!);
    await waitFor(() => expect(run).toHaveBeenCalledWith("saveManifest", expect.objectContaining({ orderId: null, customerId: null })));
  });
});
