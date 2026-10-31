// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { App } from "./main";
import { workFixture } from "./work-fixture";
import { projectWork, type WorkScope } from "./work";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
let requests: Mock<(url: string) => Promise<Response>>;
beforeEach(() => {
  window.history.replaceState(null, "", "/?workflow=StockFirst#cartons");
  localStorage.clear();
  requests = vi.fn(async (url: string) => {
    const s = workFixture();
    if (url === "/api/auth/me") return json({ user: { name: "Group Tester", roles: ["Admin"] }, csrf: "fixture-csrf" });
    if (url.startsWith("/api/state")) return json(s);
    if (url.startsWith("/api/work/")) {
      const [kind, id] = url.split("?")[0].split("/").slice(3);
      if (id === "MISSING") return json({ error: "Not found" }, 404);
      const selected = projectWork(s, { kind, id } as WorkScope);
      return json({ ...selected, hasMore: false });
    }
    throw Error("Unexpected request: " + url);
  });
  vi.stubGlobal("fetch", requests);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

async function choose(id: string) {
  fireEvent.change(screen.getByLabelText("Show work"), { target: { value: "shipment:" + id } });
  await waitFor(() => expect(screen.queryByText("Opening selected work…")).toBeNull());
}

function navigate(label: string) {
  fireEvent.click(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: label }));
}

describe("shipment grouping across sidebar pages", () => {
  it("keeps carton groups compact and opens the shipment the operator chooses", async () => {
    render(<App />);
    await screen.findByText("CT-ONE");
    const first = screen.getByLabelText(/Select shown cartons in.*SHIP-A/).closest("details")!;
    const other = screen.getByLabelText(/Select shown cartons in.*SHIP-C/).closest("details")!;
    expect(first.open).toBe(false);
    expect(other.open).toBe(false);
    fireEvent.click(first.querySelector("summary")!);
    expect(within(first).getByRole("checkbox", { name: /Select shown cartons in.*SHIP-A/ })).toBeTruthy();
    fireEvent.click(other.querySelector("summary")!);
    expect(within(other).getByRole("checkbox", { name: /Select shown cartons in.*SHIP-C/ })).toBeTruthy();
    expect(screen.getByText("CT-STOCK")).toBeTruthy();
  });

  it("keeps a shipment selected across labels, billing, loading, and refresh", async () => {
    const first = render(<App />);
    await screen.findByText("CT-ONE");
    await choose("SHIP-B");
    await screen.findByText("CT-TWO");
    expect(screen.queryByText("CT-ONE")).toBeNull();
    expect(screen.queryByText("CT-THREE")).toBeNull();
    navigate("Billing");
    await screen.findByText("JOB-SHIP-B");
    expect(screen.queryByText("JOB-SHIP-A")).toBeNull();
    navigate("Labels");
    fireEvent.click(screen.getByRole("button", { name: "Scan for dispatch" }));
    await screen.findByLabelText("Customer shipment");
    expect((screen.getByLabelText("Customer shipment") as HTMLSelectElement).value).toBe("SHIP-B");
    expect(new URLSearchParams(window.location.search).get("work")).toBe("shipment:SHIP-B");
    first.unmount();
    render(<App />);
    await screen.findByLabelText("Customer shipment");
    expect((screen.getByLabelText("Show work") as HTMLSelectElement).value).toBe("shipment:SHIP-B");
    expect((screen.getByLabelText("Customer shipment") as HTMLSelectElement).value).toBe("SHIP-B");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("clears carton selections when the operator changes shipment", async () => {
    render(<App />);
    await screen.findByText("CT-ONE");
    await choose("SHIP-A");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select CT-ONE" }));
    expect(screen.getByRole("button", { name: "Print selected (1)" }).hasAttribute("disabled")).toBe(false);
    await choose("SHIP-B");
    await screen.findByText("CT-TWO");
    expect(screen.getByRole("button", { name: "Print selected (0)" }).hasAttribute("disabled")).toBe(true);
  });

  it("allows clearing a selected shipment to show all work again", async () => {
    render(<App />);
    await screen.findByText("CT-ONE");
    await choose("SHIP-A");
    fireEvent.click(await screen.findByRole("button", { name: "Show all work" }));
    expect(await screen.findByText("CT-TWO")).toBeTruthy();
    expect(new URLSearchParams(window.location.search).has("work")).toBe(false);
  });

  it("blocks work switching while a scan result is uncertain", async () => {
    render(<App />);
    await screen.findByText("CT-ONE");
    localStorage.setItem("electro-group-uncertain-scan-v1", JSON.stringify({ envelope: { requestId: "fixture-request" }, shipmentId: "SHIP-A" }));
    fireEvent.change(screen.getByLabelText("Show work"), { target: { value: "shipment:SHIP-B" } });
    expect(screen.getByRole("alert").textContent).toContain("Check the last scan result");
    expect((screen.getByLabelText("Show work") as HTMLSelectElement).value).toBe("all");
    expect(requests.mock.calls.some(([url]) => url.startsWith("/api/work/"))).toBe(false);
  });

  it("lets the operator clear a stale bookmarked work ID", async () => {
    window.history.replaceState(null, "", "/?workflow=StockFirst&work=shipment%3AMISSING#cartons");
    render(<App />);
    const clear = await screen.findByRole("button", { name: "Show all work" });
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.click(clear);
    expect(await screen.findByText("CT-ONE")).toBeTruthy();
  });

  it("groups available cartons by packing list inside the reservation dialog", async () => {
    render(<App />);
    await screen.findByText("CT-ONE");
    fireEvent.change(screen.getByLabelText("Show work"), { target: { value: "trip:TRIP-A" } });
    await waitFor(() => expect(screen.queryByText("Opening selected work…")).toBeNull());
    navigate("Trips");
    const trip = (await screen.findByRole("heading", { name: "KA-01-ALPHA" })).closest("section")!;
    const tripDetails = trip.querySelector("details")!;
    if (!tripDetails.open) fireEvent.click(tripDetails.querySelector("summary")!);
    fireEvent.click(within(trip).getByRole("button", { name: "Add customer & cartons" }));
    const dialog = screen.getByRole("dialog", { name: "Choose cartons for a customer" });
    expect(within(dialog).getByText("Packing Alpha", { exact: true })).toBeTruthy();
    expect(within(dialog).getByText("Packing Beta", { exact: true })).toBeTruthy();
    expect(within(dialog).getByText("CT-FREE")).toBeTruthy();
    expect(within(dialog).getByText("CT-STOCK")).toBeTruthy();
    expect(within(dialog).queryByText("CT-ONE")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Show only this/ })).toBeNull();
  });

  it("loads the chosen packing list even when its cartons are outside the initial list", async () => {
    const original = requests.getMockImplementation()!;
    requests.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/state")) {
        const s = workFixture();
        s.cartons = s.cartons.filter((c) => c.id !== "CT-STOCK");
        return json(s);
      }
      return original(url);
    });
    render(<App />);
    await screen.findByText("CT-ONE");
    navigate("Trips");
    const trip = (await screen.findByRole("heading", { name: "KA-01-ALPHA" })).closest("section")!;
    const tripDetails = trip.querySelector("details")!;
    if (!tripDetails.open) fireEvent.click(tripDetails.querySelector("summary")!);
    fireEvent.click(within(trip).getByRole("button", { name: "Add customer & cartons" }));
    const dialog = screen.getByRole("dialog", { name: "Choose cartons for a customer" });
    expect(within(dialog).queryByText("CT-STOCK")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Choose packing list"), { target: { value: "PACK-B" } });
    expect(await within(dialog).findByText("CT-STOCK")).toBeTruthy();
    expect(within(dialog).queryByText("CT-FREE")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Select group (1 carton)" }));
    expect(within(dialog).getByRole("button", { name: "Reserve 1 carton" }).hasAttribute("disabled")).toBe(false);
  });
});
