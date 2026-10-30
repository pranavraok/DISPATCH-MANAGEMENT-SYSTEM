import type { Row, State } from "./domain";
let csrf = "";
export async function api(path: string, options: RequestInit = {}) {
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
  const result = await response
    .json()
    .catch(() => ({
      error: "The application API is not connected to this deployment.",
    }));
  if (!response.ok)
    throw Error(result.error ?? result.message ?? "Request failed.");
  return result;
}
export async function login(email: string, password: string) {
  const result = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  csrf = result.csrf;
  return result.user;
}
export async function me() {
  const result = await api("/auth/me");
  csrf = result.csrf;
  return result.user;
}
export const state = (): Promise<State> => api("/state");
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
