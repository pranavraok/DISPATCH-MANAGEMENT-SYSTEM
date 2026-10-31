import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  LayoutDashboard,
  Package,
  ScanLine,
  Truck,
  ReceiptText,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Plus,
  RefreshCw,
  Search,
  ChevronRight,
  LogOut,
  ShieldCheck,
  Printer,
  ClipboardCheck,
  ClipboardList,
  RotateCcw,
  Activity,
  AlertTriangle,
  Check,
  WifiOff,
  Box,
  FileDown,
  Menu,
  X,
  Clock3,
} from "lucide-react";
import * as client from "./api";
import { sampleState } from "./sample";
import {
  date,
  number,
  money,
  parse,
  totals,
  type Row,
  type State,
  type Group,
} from "./domain";
import { labelPdf, packingPdf, download } from "./labels";
import {
  PackingScreen,
  CartonScreen,
  TripsScreen,
  BillingScreen,
  SetupScreen,
  ReturnsScreen,
  ReportsScreen,
} from "./screens";
import { hasPendingScan } from "./scanner";
import { projectWork, readWorkScope, workKey, type WorkScope } from "./work";
import { WorkSelector, ShipmentOverview } from "./work-ui";
import { brand, plainLabel } from "./brand";
import { readWorkflow, workflows, sampleWorkflow, type Workflow } from "./workflow";
import { WorkflowChooser, OrdersScreen } from "./workflow-ui";
import { pendingScanWorkflow } from "./scanner";
import "./style.css";
import "./clean.css";
import "./workflow-picker.css";
export type Context = {
  workflow?: Workflow;
  s: State;
  all: State;
  work: WorkScope;
  selectWork: (scope: WorkScope) => boolean;
  user: Row;
  sample: boolean;
  run: (type: string, data: Row) => Promise<any>;
  refresh: () => Promise<void>;
  navigate: (page: string) => void;
};
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{typeof children === "string" ? plainLabel(children) : children}</span>;
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <Box size={30} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
const nav = [
  ["overview", "Home", LayoutDashboard],
  ["orders", "Orders", ClipboardList],
  ["packing", "Packing", Package],
  ["trips", "Trips", Truck],
  ["cartons", "Labels", ClipboardCheck],
  ["billing", "Billing", ReceiptText],
  ["returns", "Returns", RotateCcw],
  ["reports", "Reports", Activity],
  ["setup", "Shared settings", Settings],
] as const;
function savedPage() {
  const page = window.location.hash.slice(1);
  return page === "loading" ? "cartons" : nav.some(([id]) => id === page) ? page : "overview";
}
export function App() {
  const [user, setUser] = useState<Row | null>(null),
    [s, setState] = useState<State | null>(null),
    [sample, setSample] = useState(false),
    [workflow, setWorkflow] = useState<Workflow | null>(readWorkflow),
    [page, setPage] = useState(savedPage),
    [work, setWork] = useState<WorkScope>(readWorkScope),
    [workRetry, setWorkRetry] = useState(0),
    [workError, setWorkError] = useState(""),
    [sessionStatus, setSessionStatus] = useState<"checking" | "ready" | "signedOut" | "unavailable">("checking"),
    [restoreAttempt, setRestoreAttempt] = useState(0),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [lastSync, setLastSync] = useState<Date | null>(null);
  const selectionKey = workKey(work);
  const contextKey = (workflow ?? "StockFirst") + ":" + selectionKey;
  const selectionRef = useRef(contextKey);
  selectionRef.current = contextKey;
  const view = useMemo(() => s ? projectWork(s, work) : null, [s, selectionKey]);
  const refresh = useCallback(async () => {
    if (sample || !workflow) return;
    try {
      const next = await client.state(undefined, work, workflow);
      if (selectionRef.current !== contextKey) return;
      setState(next);
      setLastSync(new Date());
    } catch (e) {
      if (e instanceof client.ApiError && e.status === 401) {
        setUser(null);
        setState(null);
        setSessionStatus("signedOut");
      }
      throw e;
    }
  }, [sample, selectionKey, workflow, contextKey]);
  useEffect(() => {
    const controller = new AbortController();
    setSessionStatus("checking");
    async function restore() {
      try {
        const restoredUser = await client.me(controller.signal);
        const next = await client.state(controller.signal, work, workflow ?? undefined);
        if (controller.signal.aborted) return;
        setUser(restoredUser);
        setState(next);
        setLastSync(new Date());
        setSessionStatus("ready");
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof client.ApiError && e.status === 401) {
          setUser(null);
          setState(null);
          setSessionStatus("signedOut");
        } else {
          setSessionStatus("unavailable");
        }
      }
    }
    void restore();
    return () => controller.abort();
  }, [restoreAttempt]);
  useEffect(() => {
    if (sample || !workflow || sessionStatus !== "ready" || !user || (s?.workLoadedKey === selectionKey && s?.workflow === workflow)) return;
    const controller = new AbortController();
    setWorkError("");
    client.state(controller.signal, work, workflow).then((next) => {
      if (controller.signal.aborted) return;
      setState(next);
      setLastSync(new Date());
    }).catch((e) => {
      if (controller.signal.aborted) return;
      if (e instanceof client.ApiError && e.status === 401) setSessionStatus("signedOut");
      else setWorkError("Could not load this work. Please try again.");
    });
    return () => controller.abort();
  }, [selectionKey, workflow, workRetry, sample, sessionStatus, user, s?.workLoadedKey, s?.workflow]);
  useEffect(() => {
    const restorePage = () => { setPage(savedPage()); setWork(readWorkScope()); setWorkflow(readWorkflow()); };
    window.addEventListener("hashchange", restorePage);
    window.addEventListener("popstate", restorePage);
    return () => { window.removeEventListener("hashchange", restorePage); window.removeEventListener("popstate", restorePage); };
  }, []);
  function selectWork(next: WorkScope) {
    if (workKey(next) === selectionKey) return true;
    if (hasPendingScan()) {
      setError("Check the last scan result in Labels > Scan for dispatch before changing the selected work.");
      return false;
    }
    const url = new URL(window.location.href);
    if (next.kind === "all") url.searchParams.delete("work");
    else url.searchParams.set("work", workKey(next));
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    setWork(next);
    setWorkError("");
    return true;
  }
  function chooseWorkflow(next: Workflow) {
    if (hasPendingScan() && next !== pendingScanWorkflow()) {
      setError("Resolve the pending scan in its original workflow before switching."); return false;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("workflow", next); url.searchParams.delete("work"); url.searchParams.delete("labels"); url.searchParams.delete("order");
    window.history.replaceState(null, "", url.pathname + url.search + "#overview");
    setWorkflow(next); setWork({ kind: "all" }); setPage("overview"); setWorkError(""); setError("");
    if (sample) setState(sampleWorkflow(sampleState(), next));
    return true;
  }
  function changeWorkflow() {
    if (hasPendingScan()) { setError("Resolve the pending scan before switching workflows."); return; }
    const url = new URL(window.location.href); url.searchParams.delete("workflow"); url.searchParams.delete("work"); url.searchParams.delete("labels"); url.searchParams.delete("order");
    window.history.replaceState(null, "", url.pathname + url.search + "#overview");
    setWorkflow(null); setWork({ kind: "all" }); setPage("overview"); setMobile(false);
  }
  function navigate(next: string) {
    if (next === "loading" || next === "printLabels") {
      const url = new URL(window.location.href);
      if (next === "loading") url.searchParams.set("labels", "scan");
      else url.searchParams.delete("labels");
      window.history.replaceState(null, "", url.pathname + url.search + "#cartons");
      setPage("cartons");
      return;
    }
    if (!nav.some(([id]) => id === next)) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search + "#" + next);
    setPage(next);
  }
  useEffect(() => {
    if (!user || sample || sessionStatus !== "ready") return;
    const timer = setInterval(
      () =>
        refresh().catch(() =>
          setError(
            "Connection lost. The numbers may be old. Wait for confirmation before loading a carton.",
          ),
        ),
      15000,
    );
    return () => clearInterval(timer);
  }, [user, sample, refresh, sessionStatus]);
  async function run(type: string, data: Row) {
    if (sample)
      throw Error(
        "This is a sample. Sign in to save your work.",
      );
    setBusy(true);
    setError("");
    const request = client.envelope(type, { ...data, workflow: workflow ?? "StockFirst" });
    try {
      const result = await client.send(request);
      const deletedKind = { deleteManifest: "packing", deleteTrip: "trip", deleteShipment: "shipment" }[type];
      const refreshAfterSave = deletedKind === work.kind && work.kind !== "all" && data.id === work.id
        ? (async () => { selectWork({ kind: "all" }); const next = await client.state(undefined, { kind: "all" }, workflow ?? undefined); setState(next); setLastSync(new Date()); })()
        : refresh();
      await refreshAfterSave.catch(() =>
        setError("Saved. Refresh the page to see the latest information."),
      );
      setToast(result.message ?? "Saved.");
      setTimeout(() => setToast(""), 6000);
      return result;
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function onLogin(email: string, password: string) {
    const u = await client.login(email, password);
    setUser(u);
    setSample(false);
    setWorkflow(null); setWork({ kind: "all" });
    const url = new URL(window.location.href); url.searchParams.delete("workflow"); url.searchParams.delete("work"); url.searchParams.delete("order"); url.searchParams.delete("labels");
    window.history.replaceState(null, "", url.pathname + url.search + "#overview"); setPage("overview");
    setSessionStatus("checking");
    try {
      const next = await client.state();
      setState(next);
      setLastSync(new Date());
      setSessionStatus("ready");
    } catch (e) {
      setSessionStatus(e instanceof client.ApiError && e.status === 401 ? "signedOut" : "unavailable");
    }
  }
  async function logout() {
    setBusy(true);
    try {
      if (!sample) await client.api("/auth/logout", { method: "POST" });
      setUser(null);
      setState(null);
      setSample(false);
      setSessionStatus("signedOut");
      setError("");
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function preview() {
    setSample(true);
    setUser({
      name: "Sample visitor",
      roles: ["MD"],
      email: "Read-only workspace",
    });
    setState(sampleState());
    setWorkflow(null);
    setSessionStatus("ready");
  }
  if (sessionStatus === "signedOut") return <Login onLogin={onLogin} preview={preview} />;
  if (sessionStatus !== "ready" || !user || !s) {
    return <SessionNotice unavailable={sessionStatus === "unavailable"} retry={() => setRestoreAttempt((n) => n + 1)} />;
  }
  if (!workflow) return <WorkflowChooser choose={chooseWorkflow} user={user} error={error} signOut={() => void logout()} openSettings={() => { if (chooseWorkflow("StockFirst")) navigate("setup"); }} />;
  const ctx: Context = { s: view!, all: s, work, selectWork, user, sample, run, refresh, navigate, workflow };
  const current = nav.find((x) => x[0] === page)!;
  const screens: Record<string, ReactNode> = {
    overview: <Overview {...ctx} />,
    orders: <OrdersScreen key={workflow} {...ctx} />,
    packing: <PackingScreen key={selectionKey} {...ctx} />,
    cartons: <CartonScreen key={selectionKey} {...ctx} />,
    trips: <TripsScreen key={selectionKey} {...ctx} />,
    billing: <BillingScreen key={selectionKey} {...ctx} />,
    returns: <ReturnsScreen key={selectionKey} {...ctx} />,
    reports: <ReportsScreen {...ctx} />,
    setup: <SetupScreen {...ctx} s={s} />,
  };
  return (
    <div className="app">
      {mobile && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobile(false)} />}
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <div className="brand-mark">
            E
          </div>
          <div>
            {brand.shortName}<small>GROUP OF INDUSTRIES</small>
          </div>
        </a>
        <div className="sidebar-workflow"><span>WORKFLOW</span><strong>{workflows[workflow].title}</strong><button className="text-link" onClick={changeWorkflow}>Switch workflow <ArrowRight size={14} /></button></div>
        <nav aria-label="Main navigation">
          {[
            ["Prepare", ["overview", "orders", "packing"]],
            ["Dispatch", ["trips", "cartons", "billing"]],
            ["History", ["returns", "reports"]],
            ["Company", ["setup"]],
          ].map(([label, ids]) => <div className="nav-group" key={String(label)}><div className="nav-label">{label}</div>{nav.filter(([id]) => (ids as string[]).includes(id)).map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => {
                navigate(id);
                setMobile(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {page === id && <ChevronRight size={15} />}
            </button>
          ))}</div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="signed-in-user">{user.name}</div>
          <button
            className="profile"
            aria-label={"Sign out " + user.name}
            onClick={() => void logout()}
            disabled={busy}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobile(!mobile)}
              aria-label="Toggle navigation"
            >
              <Menu />
            </button>
            <span className="breadcrumb">
              Dispatch <ChevronRight size={13} />
              <strong>{current[1]}</strong>
            </span>
          </div>
          <div className="top-actions">
            <span className={"connection " + (sample ? "muted" : "")}>
              <span className={"dot " + (sample ? "amber" : "green")} />
              {sample ? "Sample workspace" : "Connected"}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh saved state"
              onClick={() => refresh().catch((e) => setError(e.message))}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <div className="content">
          {sample && (
            <div className="sample-banner">
              <ShieldCheck size={17} />
              <span>
                SAMPLE ONLY · Try the screens here. Sign in to save your work.
              </span>
              <button
                onClick={() => {
                  setUser(null);
                  setState(null);
                  setSample(false);
                  setSessionStatus("signedOut");
                }}
              >
                Sign in <ArrowRight size={14} />
              </button>
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <AlertTriangle size={18} />
              {error}
              <button aria-label="Dismiss" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {(sample || s.workflow === workflow) && <WorkSelector ctx={ctx} companyWide={page === "setup" || page === "orders"} />}
          {s.workMissing && <div className="notice amber">This work was not found. Choose another packing list, trip, or shipment, or select Show all work.</div>}
          {!sample && (s.workLoadedKey !== selectionKey || s.workflow !== workflow) ? <section className="panel panel-padding" role="status"><h2>{workError || "Opening your workflow…"}</h2>{workError && <button className="secondary" onClick={() => setWorkRetry((n) => n + 1)}>Try again</button>}</section> : <>
            {s.workComplete === false && work.kind !== "all" && <div className="notice amber">Showing up to 5,000 carton details out of {number(s.workCartonTotal ?? 0)}. Choose a smaller shipment for a complete view.</div>}
            {screens[page]}
          </>}
        </div>
        <footer className="app-footer">
          <span>{brand.name}</span>
          <span>
            {sample
              ? "Sample data"
              : `Saved state · ${lastSync ? date(lastSync) : date(s.serverTime)}`}{" "}
            <span className="footer-version">v0.1 · Trial</span>
          </span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {busy && <div className="saving">Saving…</div>}
    </div>
  );
}
function SessionNotice({ unavailable, retry }: { unavailable: boolean; retry: () => void }) {
  return (
    <div className="session-screen">
      <section className="panel session-panel" aria-busy={!unavailable}>
        <div className="session-brand">{brand.name}</div>
        {unavailable ? <WifiOff size={30} /> : <RefreshCw size={30} className="session-spinner" />}
        <h1>{unavailable ? "Could not open your workspace" : "Opening your workspace…"}</h1>
        <p role="status">{unavailable ? "Please check your connection and try again. Your saved sign-in will be checked again; you do not need to enter your password unless the session has ended." : "Checking your saved sign-in. Please wait."}</p>
        {unavailable && <button className="primary" onClick={retry}>Try again <RefreshCw size={16} /></button>}
      </section>
    </div>
  );
}
function Login({
  onLogin,
  preview,
}: {
  onLogin: (e: string, p: string) => Promise<void>;
  preview: () => void;
}) {
  const [email, setEmail] = useState(brand.email),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [connectionNote, setConnectionNote] = useState("");
  useEffect(() => {
    fetch("/api/health")
      .then((response) => {
        if (!response.ok)
          setConnectionNote(
            "Cannot connect to saved data. Please try again. You can still view the sample.",
          );
      })
      .catch(() =>
        setConnectionNote("Cannot connect. Please try again."),
      );
  }, []);
  return (
    <div className="login">
      <section className="login-story">
        <a className="brand">
          <div className="brand-mark">
            E
          </div>
          <div>
            {brand.shortName}<small>GROUP OF INDUSTRIES</small>
          </div>
        </a>
        <div>
          <Badge tone="dark">PACK · CHECK · DISPATCH</Badge>
          <h1>
            Dispatch made
            <br />
            simple.
          </h1>
          <p>
            Pack before an order arrives, or prepare cartons for an existing order. One shared setup for both.
          </p>
          <div className="login-flow">
            <span>
              <Package />
              Register
            </span>
            <ArrowRight />
            <span>
              <ScanLine />
              Verify
            </span>
            <ArrowRight />
            <span>
              <Truck />
              Dispatch
            </span>
          </div>
        </div>
        <small>{brand.name} · {brand.business}</small>
      </section>
      <section className="login-form">
        <div className="eyebrow">DISPATCH</div>
        <h2>Sign in</h2>
        {connectionNote && <div className="notice amber">{connectionNote}</div>}
        <p>Sign in once, then choose your dispatch workflow.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await onLogin(email, password);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Work email">
            <input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && <div className="notice error">{error}</div>}
          <button className="primary wide" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="login-divider">VIEW THE SCREENS</div>
        <button className="secondary wide" onClick={preview}>
          View sample <ArrowUpRight size={16} />
        </button>
        <div className="login-note">
          <ShieldCheck size={19} />
          <p>
            Ask your administrator for your login. The sample uses made-up data.
          </p>
        </div>
      </section>
    </div>
  );
}
function Overview(ctx: Context) {
  const { s, navigate } = ctx;
  const workflow = ctx.workflow ?? "StockFirst", info = workflows[workflow], orderFirst = workflow === "OrderFirst";
  const count = (state: string) => s.counts.find((x) => x.state === state)?.count ?? 0;
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">{orderFirst ? "ORDER RECEIVED" : "MANUFACTURED STOCK"}</span><h1>{info.title}</h1><p>{info.description}</p></div>
        <button className="primary" onClick={() => navigate(orderFirst ? "orders" : "packing")}><Plus size={17} />{orderFirst ? "Open customer orders" : "Add packed cartons"}</button>
      </div>
      <div className="home-totals" aria-label="Work summary">
        <div><strong>{number(s.manifests.filter((m) => m.state === "Draft").length)}</strong><span>Lists to approve</span></div>
        <div><strong>{number(count("Available"))}</strong><span>Available cartons</span></div>
        <div><strong>{number(count("Loaded"))}</strong><span>Loaded cartons</span></div><div><strong>{number((s.orders ?? []).length)}</strong><span>Customer orders</span></div>
      </div>
      <nav className="task-flow" aria-label="Dispatch steps">
          {(orderFirst ? [["Receive order", "orders"], ["Pack & label", "packing"], ["Trips", "trips"], ["Scan in Labels", "loading"], ["Billing", "billing"]] : [["Pack stock", "packing"], ["Print labels", "printLabels"], ["Receive order", "orders"], ["Choose cartons", "trips"], ["Scan & bill", "loading"]]).map(([title, target], i) => <button key={target} onClick={() => navigate(target)}><span>{i + 1}</span>{title}<ChevronRight size={14} /></button>)}
      </nav>
      <ShipmentOverview ctx={ctx} />
      <details className="panel supporting-panel">
        <summary>Recent packing lists <span>{s.manifests.length}</span></summary>
        {s.manifests.length ? <div className="table-wrap"><table><thead><tr><th>PACKING LIST</th><th>CARTONS</th><th>STATUS</th><th /></tr></thead><tbody>{s.manifests.slice(0, 4).map((m) => <tr key={m.id}><td><strong>{m.name}</strong></td><td>{parse<Group[]>(m.groups).reduce((n, g) => n + g.count, 0)}</td><td><Badge tone={m.state === "Approved" ? "sage" : "amber"}>{m.state === "Draft" ? "Needs approval" : m.state}</Badge></td><td><button className="text-link" onClick={() => navigate("packing")} aria-label={"Open " + m.name}>Open <ArrowRight size={14} /></button></td></tr>)}</tbody></table></div> : <Empty title="No packing lists yet" detail="Add the packed cartons to get started." />}
      </details>
    </>
  );
}
function Metric({
  title,
  value,
  detail,
  icon,
  attention = false,
}: {
  title: string;
  value: string;
  detail: string;
  icon: ReactNode;
  attention?: boolean;
}) {
  return (
    <section className="metric">
      <div className="metric-top">
        <span>{title}</span>
        <span className={"metric-icon " + (attention ? "amber-icon" : "")}>
          {icon}
        </span>
      </div>
      <div className="metric-value">{value}</div>
      <p>{detail}</p>
    </section>
  );
}
