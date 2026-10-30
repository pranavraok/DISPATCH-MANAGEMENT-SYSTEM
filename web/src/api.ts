import type { Row, State } from "./domain";
import { workKey, type WorkScope } from "./work";
let csrf = "";
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(15000),
  });
  const body = await response.text();
  let result: Row = {};
  if (body) {
    try {
      result = JSON.parse(body);
    } catch {
      throw new ApiError("Could not load saved data. Please try again.", response.ok ? 502 : response.status);
    }
  }
  if (!response.ok)
    throw new ApiError(result.error ?? result.message ?? "Request failed.", response.status);
  return result as T;
}
export async function login(email: string, password: string) {
  const result = await api<{ user: Row; csrf: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  csrf = result.csrf;
  return result.user;
}
export async function me(signal?: AbortSignal) {
  const result = await api<{ user: Row; csrf: string }>("/auth/me", { signal });
  csrf = result.csrf;
  return result.user;
}
export async function state(signal?: AbortSignal, scope: WorkScope = { kind: "all" }): Promise<State> {
  const state = await api<State>("/state", { signal });
  state.workLoadedKey = workKey(scope);
  state.workComplete = true;
  if (scope.kind === "all") return state;
  const keys = ["cartons", "manifests", "trips", "shipments", "allocations", "billings", "jobs", "returns", "labels", "audit"] as const;
  for (let page = 0; page < 10; page++) {
    let detail: Row;
    try {
      detail = await api<Row>(`/work/${scope.kind}/${encodeURIComponent(scope.id)}?page=${page}`, { signal });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return { ...state, workMissing: true };
      throw e;
    }
    for (const key of keys) {
      const merged = new Map(state[key].map((row) => [row.id, row]));
      for (const row of detail[key]) merged.set(row.id, row);
      state[key] = [...merged.values()];
    }
    state.workCartonTotal = detail.cartonTotal;
    state.workComplete = !detail.hasMore;
    if (!detail.hasMore) break;
  }
  return state;
}
export type Envelope = { requestId: string; type: string; data: Row };
export const envelope = (type: string, data: Row): Envelope => ({
  requestId: crypto.randomUUID(),
  type,
  data,
});
export const send = (request: Envelope) =>
  api("/commands", { method: "POST", body: JSON.stringify(request) });
export const reconcile = (requestId: string) =>
  api("/requests/" + encodeURIComponent(requestId));
