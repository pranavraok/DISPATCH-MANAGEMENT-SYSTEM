// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./main";
import { sampleState } from "./sample";

const user = { id: "operator", name: "Test Operator", roles: ["Admin"], email: "operator@example.test" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
let signedOut: boolean;
let stateFailures: number;
let meFailure: boolean;
let logoutFailure: boolean;
let meResult: Promise<Response> | undefined;
let requests: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.replaceState(null, "", "/?workflow=StockFirst");
  signedOut = false;
  stateFailures = 0;
  meFailure = false;
  logoutFailure = false;
  meResult = undefined;
  requests = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/auth/me") {
      if (meResult) return meResult;
      if (meFailure) throw new TypeError("Failed to fetch");
      return signedOut ? json({ error: "Session expired." }, 401) : json({ user, csrf: "restored-csrf" });
    }
    if (url.startsWith("/api/state")) {
      if (stateFailures-- > 0) return json({ error: "Database temporarily unavailable." }, 503);
      return signedOut ? json({ error: "Session expired." }, 401) : json(sampleState());
    }
    if (url === "/api/auth/login") {
      signedOut = false;
      return json({ user, csrf: "login-csrf" });
    }
    if (url === "/api/auth/logout") {
      expect((options?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("restored-csrf");
      if (logoutFailure) throw new TypeError("Failed to fetch");
      signedOut = true;
      return new Response(null, { status: 200 });
    }
    if (url === "/api/health") return json({ database: "Connected" });
    throw new Error("Unexpected request: " + url);
  });
  vi.stubGlobal("fetch", requests);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("saved sign-in on refresh", () => {
  it("waits for a slow saved-session check without flashing a password form", async () => {
    let finish!: (result: Response) => void;
    meResult = new Promise((resolve) => { finish = resolve; });
    render(<App />);
    expect(screen.getByRole("heading", { name: "Opening your workspace…" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    await act(async () => { finish(json({ user, csrf: "restored-csrf" })); });
    expect(await screen.findByRole("heading", { name: "Pack before order" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(requests.mock.calls.every(([, options]) => options?.credentials === "include")).toBe(true);
  });

  it("opens the login form when the server confirms the session expired", async () => {
    signedOut = true;
    render(<App />);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(await screen.findByLabelText("Password")).toBeTruthy();
  });

  it("keeps a temporary database error out of the login flow and retries the saved session", async () => {
    stateFailures = 1;
    render(<App />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Pack before order" })).toBeTruthy();
    expect(requests.mock.calls.some(([url]) => url === "/api/auth/login")).toBe(false);
  });

  it("recovers from a failed network check without asking for the password", async () => {
    meFailure = true;
    render(<App />);
    await screen.findByRole("button", { name: "Try again" });
    expect(screen.queryByLabelText("Password")).toBeNull();
    meFailure = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Pack before order" })).toBeTruthy();
  });

  it("keeps the selected page when the application is remounted after a refresh", async () => {
    window.history.replaceState(null, "", "/?workflow=StockFirst#packing");
    const first = render(<App />);
    await screen.findByRole("heading", { name: /^Packing/ });
    fireEvent.click(screen.getByRole("button", { name: /^Reports/ }));
    expect(window.location.hash).toBe("#reports");
    first.unmount();
    render(<App />);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(await screen.findByRole("heading", { name: /^Reports/ })).toBeTruthy();
  });

  it("restores the session's CSRF token and stays signed out after an explicit logout", async () => {
    const first = render(<App />);
    await screen.findByRole("heading", { name: "Pack before order" });
    fireEvent.click(screen.getByRole("button", { name: /Test Operator/ }));
    await screen.findByLabelText("Password");
    expect(signedOut).toBe(true);
    first.unmount();
    render(<App />);
    expect(await screen.findByLabelText("Password")).toBeTruthy();
  });

  it("does not pretend to sign out when the logout request fails", async () => {
    logoutFailure = true;
    render(<App />);
    await screen.findByRole("heading", { name: "Pack before order" });
    fireEvent.click(screen.getByRole("button", { name: /Test Operator/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pack before order" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("keeps a newly successful login when loading data needs a retry", async () => {
    signedOut = true;
    stateFailures = 1;
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "fixture-password" } });
    fireEvent.submit(screen.getByLabelText("Password").closest("form")!);
    await screen.findByRole("button", { name: "Try again" });
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "How are we preparing this dispatch?" })).toBeTruthy();
    expect(requests.mock.calls.filter(([url]) => url === "/api/auth/login")).toHaveLength(1);
  });
});
