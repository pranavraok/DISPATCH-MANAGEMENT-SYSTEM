// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./main";
import { configureSite, type Site } from "./site";
import { readWorkflow } from "./workflow";
import { sampleState } from "./sample";
import { brand } from "./brand";

afterEach(() => { cleanup(); configureSite(null); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, "", "/"); });
for (const [slug, workflow, companyName, shortName, tagline, email] of [
  ["electro", "OrderFirst", "Electro Group of Industries", "ELECTRO", "GROUP OF INDUSTRIES", "admin@electrogroup.test"],
  ["aromazon", "StockFirst", "AROMAZEN PVT LTD", "AROMAZEN", "PVT LTD", "admin@aromazon.test"],
] as const) {
  it(slug + " opens its own fixed dashboard and ignores the other workflow in the URL", async () => {
    configureSite({ slug, workflow, companyName, shortName, tagline, email, companyId: slug } satisfies Site);
    window.history.replaceState(null, "", "/?workflow=" + (workflow === "OrderFirst" ? "StockFirst" : "OrderFirst"));
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      requests.push(path);
      return new Response(JSON.stringify(path === "/api/auth/me" ? { user: { id: "admin", companyId: slug, name: "Admin", roles: ["Admin"] }, csrf: "qa" } : { ...sampleState(), workflow, orders: [], company: { id: slug, name: companyName } }));
    }));
    render(<App />);
    await screen.findByRole("heading", { name: workflow === "OrderFirst" ? "Order first" : "Packed stock & dispatch" });
    expect(readWorkflow()).toBe(workflow);
    expect(brand.name).toBe(companyName);
    expect(requests.some(path => path.includes("workflow=" + workflow))).toBe(true);
    expect(screen.queryByText(/Switch workflow/)).toBeNull();
    expect(screen.queryByText("How are we preparing this dispatch?")).toBeNull();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Settings" }));
    expect(await screen.findByText(/Manage this company's products/)).toBeTruthy();
    expect(screen.queryByText(/One setup for both workflows/)).toBeNull();
  });
}
