import type { Row, State } from "./domain";
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
export const state = (signal?: AbortSignal): Promise<State> => api<State>("/state", { signal });
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
