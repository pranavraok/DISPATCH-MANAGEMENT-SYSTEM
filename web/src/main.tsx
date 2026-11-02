import { useEffect, useState, useCallback, useMemo, useRef, Children, isValidElement, type ReactNode } from "react";
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
import { site } from "./site";
import { readWorkflow, workflows, sampleWorkflow, orderCartons, type Workflow } from "./workflow";
import { WorkflowChooser, OrdersScreen } from "./workflow-ui";
import { pendingScanWorkflow } from "./scanner";
import "./style.css";
import "./clean.css";
import "./workflow-picker.css";
import "./company-theme.css";
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
  function containsRequiredControl(node: ReactNode): boolean {
    return Children.toArray(node).some((child) => {
      if (!isValidElement<{ required?: boolean; children?: ReactNode }>(child)) return false;
      return child.props.required === true || containsRequiredControl(child.props.children);
    });
  }
  const required = containsRequiredControl(children);
  return (
    <label className="field">
      <span>{label}{required && <span className="field-required" aria-hidden="true">*</span>}</span>
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
  ["setup", "Settings", Settings],
] as const;
const connectionWarning = "Connection lost. The numbers may be old. Wait for confirmation before loading a box.";
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
  const connectionFailures = useRef(0);
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
      connectionFailures.current = 0;
      setError((previous) => previous === connectionWarning ? "" : previous);
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
    if (site && next !== site.workflow) return false;
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
    if (site) return;
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
    const timer = setInterval(() => {
      refresh().catch(() => {
        connectionFailures.current += 1;
        // Ignore brief Wi-Fi/API blips. Show the warning only after three
        // consecutive failed polls (45 seconds), and only once until recovery.
        if (connectionFailures.current >= 3)
          setError((previous) => previous || connectionWarning);
      });
    }, 15000);
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
    setWorkflow(site?.workflow ?? null); setWork({ kind: "all" });
    const url = new URL(window.location.href); url.searchParams.delete("workflow"); url.searchParams.delete("work"); url.searchParams.delete("order"); url.searchParams.delete("labels");
    window.history.replaceState(null, "", url.pathname + url.search + "#overview"); setPage("overview");
    setSessionStatus("checking");
    try {
      const next = await client.state(undefined, { kind: "all" }, site?.workflow);
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
    setState(site ? { ...sampleWorkflow(sampleState(), site.workflow), company: { ...sampleState().company, name: site.companyName, id: site.companyId } } : sampleState());
    setWorkflow(site?.workflow ?? null);
    setSessionStatus("ready");
  }
  if (sessionStatus === "signedOut") return <Login onLogin={onLogin} preview={preview} />;
  if (sessionStatus !== "ready" || !user || !s) {
    return <SessionNotice unavailable={sessionStatus === "unavailable"} retry={() => setRestoreAttempt((n) => n + 1)} />;
  }
  if (!workflow) return <WorkflowChooser choose={chooseWorkflow} user={user} error={error} signOut={() => void logout()} openSettings={() => { if (chooseWorkflow("StockFirst")) navigate("setup"); }} />;
  const ctx: Context = { s: view!, all: s, work, selectWork, user, sample, run, refresh, navigate, workflow };
  const simpleElectro = site?.slug === "electro" && workflow === "OrderFirst" && !sample;
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
            {brand.initial}
          </div>
          <div>
            {brand.shortName}<small>{brand.tagline}</small>
          </div>
        </a>
        {simpleElectro ? <div className="sidebar-workflow"><strong>Orders in progress</strong></div> : <div className="sidebar-workflow"><span>WORKFLOW</span><strong>{workflows[workflow].title}</strong>{!site && <button className="text-link" onClick={changeWorkflow}>Switch workflow <ArrowRight size={14} /></button>}</div>}
        <nav aria-label="Main navigation">
          {simpleElectro ? <>
            <div className="nav-group"><div className="nav-label">WORK</div><button className={page === "overview" ? "active" : ""} aria-current={page === "overview" ? "page" : undefined} onClick={() => { navigate("overview"); setMobile(false); }}><LayoutDashboard size={18} /><span>Dispatch</span>{page === "overview" && <ChevronRight size={15} />}</button><button className={page === "orders" ? "active" : ""} aria-current={page === "orders" ? "page" : undefined} onClick={() => { navigate("orders"); setMobile(false); }}><ClipboardList size={18} /><span>Past orders</span>{page === "orders" && <ChevronRight size={15} />}</button></div>
            <div className="nav-group"><div className="nav-label">COMPANY</div><button className={page === "setup" ? "active" : ""} aria-current={page === "setup" ? "page" : undefined} onClick={() => navigate("setup")}><Settings size={18} /><span>Settings</span>{page === "setup" && <ChevronRight size={15} />}</button></div>
            <details className="nav-more"><summary>More</summary><div className="nav-group">{nav.filter(([id]) => ["returns", "reports"].includes(id)).map(([id, label, Icon]) => <button key={id} className={page === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={18} /><span>{label}</span>{page === id && <ChevronRight size={15} />}</button>)}</div></details>
          </> : <>
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
              <span>{id === "setup" && !site ? "Shared settings" : label}</span>
              {page === id && <ChevronRight size={15} />}
            </button>
          ))}</div>)}
          </>}
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
              <strong>{simpleElectro && page === "overview" ? "Dispatch" : current[1]}</strong>
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
          {!simpleElectro && (sample || s.workflow === workflow) && <WorkSelector ctx={ctx} companyWide={page === "setup" || page === "orders"} />}
          {simpleElectro && page !== "overview" && <div className="dispatch-guide-return"><span>Dispatch steps</span><button className="text-link" onClick={() => navigate("overview")}>Back to next step <ArrowRight size={15} /></button></div>}
          {s.workMissing && <div className="notice amber">This work was not found. Choose another packing list, trip, or shipment, or select Show all work.</div>}
          {!sample && (s.workLoadedKey !== selectionKey || s.workflow !== workflow) ? <section className="panel panel-padding" role="status"><h2>{workError || "Opening your workflow…"}</h2>{workError && <button className="secondary" onClick={() => setWorkRetry((n) => n + 1)}>Try again</button>}</section> : <>
            {s.workComplete === false && work.kind !== "all" && <div className="notice amber">Showing up to 5,000 box details out of {number(s.workCartonTotal ?? 0)}. Choose a smaller shipment for a complete view.</div>}
            {screens[page]}
          </>}
        </div>
        <footer className="app-footer">
          <span>{brand.name}</span>
          <span>
            {sample
              ? "Sample data"
              : `Saved state · ${lastSync ? date(lastSync) : date(s.serverTime)}`}{" "}
            <span className="footer-version">Electro Production</span>
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
            {brand.initial}
          </div>
          <div>
            {brand.shortName}<small>{brand.tagline}</small>
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
            {site ? workflows[site.workflow].description : "Pack before an order arrives, or prepare boxes for an existing order. One shared setup for both."}
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
        <p>{site ? brand.name + " · " + workflows[site.workflow].title : "Sign in once, then choose your dispatch workflow."}</p>
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
  if (site?.slug === "electro" && orderFirst && !ctx.sample) return <ElectroDispatchGuide {...ctx} />;
  const count = (state: string) => s.counts.find((x) => x.state === state)?.count ?? 0;
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">{orderFirst ? "ORDER RECEIVED" : "MANUFACTURED STOCK"}</span><h1>{info.title}</h1><p>{info.description}</p></div>
        <button className="primary" onClick={() => navigate(orderFirst ? "orders" : "packing")}><Plus size={17} />{orderFirst ? "Open customer orders" : "Add packed boxes"}</button>
      </div>
      <div className="home-totals" aria-label="Work summary">
        <div><strong>{number(s.manifests.filter((m) => m.state === "Draft").length)}</strong><span>Lists to approve</span></div>
        <div><strong>{number(count("Available"))}</strong><span>Available boxes</span></div>
        <div><strong>{number(count("Loaded"))}</strong><span>Loaded boxes</span></div><div><strong>{number((s.orders ?? []).length)}</strong><span>Customer orders</span></div>
      </div>
      <nav className="task-flow" aria-label="Dispatch steps">
          {(orderFirst ? [["Receive order", "orders"], ["Pack & label", "packing"], ["Trips", "trips"], ["Scan in Labels", "loading"], ["Billing", "billing"]] : [["Pack stock", "packing"], ["Print labels", "printLabels"], ["Receive order", "orders"], ["Choose boxes", "trips"], ["Scan & bill", "loading"]]).map(([title, target], i) => <button key={target} onClick={() => navigate(target)}><span>{i + 1}</span>{title}<ChevronRight size={14} /></button>)}
      </nav>
      <ShipmentOverview ctx={ctx} />
      <details className="panel supporting-panel">
        <summary>Recent packing lists <span>{s.manifests.length}</span></summary>
        {s.manifests.length ? <div className="table-wrap"><table><thead><tr><th>PACKING LIST</th><th>BOXES</th><th>STATUS</th><th /></tr></thead><tbody>{s.manifests.slice(0, 4).map((m) => <tr key={m.id}><td><strong>{m.name}</strong></td><td>{parse<Group[]>(m.groups).reduce((n, g) => n + g.count, 0)}</td><td><Badge tone={m.state === "Approved" ? "sage" : "amber"}>{m.state === "Draft" ? "Needs approval" : m.state}</Badge></td><td><button className="text-link" onClick={() => navigate("packing")} aria-label={"Open " + m.name}>Open <ArrowRight size={14} /></button></td></tr>)}</tbody></table></div> : <Empty title="No packing lists yet" detail="Add the packed boxes to get started." />}
      </details>
    </>
  );
}
function ElectroDispatchGuide(ctx: Context) {
  const params = new URLSearchParams(window.location.search);
  const [orderId, setOrderId] = useState(params.get("order") ?? "");
  const orders = ctx.all.orders ?? [];
  const order = orders.find((item) => item.id === orderId && item.state !== "Cancelled");
  const openOrders = orders.filter((item) => item.state === "Open");
  const manifests = order ? ctx.all.manifests.filter((item) => item.orderId === order.id) : [];
  const manifest = manifests.find((item) => item.state === "Draft") ?? manifests.find((item) => item.state === "Approved");
  const manifestIds = new Set(manifests.map((item) => item.id));
  const orderCartonRows = order ? ctx.all.cartons.filter((carton) => manifestIds.has(carton.manifestId) && carton.state !== "Retired") : [];
  const cartonsReady = orderCartonRows.length > 0 && orderCartonRows.every((carton) => carton.verified);
  const shipments = order ? ctx.all.shipments.filter((item) => item.orderId === order.id && item.state !== "Cancelled") : [];
  const pendingShipment = shipments.find((item) => !item.loadApproved);
  const latestShipment = [...shipments].reverse()[0];
  const confirmedInvoiceShipmentIds = new Set(ctx.all.jobs.filter((job) => job.state === "Confirmed").map((job) => job.shipmentId));
  const orderBillingComplete = shipments.length > 0 && shipments.every((shipment) => confirmedInvoiceShipmentIds.has(shipment.id));
  const assigned = order ? orderCartons(ctx.all, order) : 0;
  const remaining = order ? Math.max(0, Number(order.expectedCartons) - assigned) : 0;

  function rememberOrder(id: string) {
    setOrderId(id);
    const next = new URL(window.location.href);
    if (id) next.searchParams.set("order", id); else next.searchParams.delete("order");
    window.history.replaceState(null, "", next.pathname + next.search + next.hash);
  }
  function openPacking() {
    if (!order) return;
    rememberOrder(order.id);
    if (manifest && !ctx.selectWork({ kind: "packing", id: manifest.id })) return;
    ctx.navigate("packing");
  }
  function openLabels() {
    if (!order || !manifest) return;
    if (!ctx.selectWork({ kind: "packing", id: manifest.id })) return;
    const next = new URL(window.location.href); next.searchParams.set("labels", "print"); next.searchParams.set("order", order.id);
    window.history.replaceState(null, "", next.pathname + next.search + "#cartons");
    ctx.navigate("cartons");
  }
  function openScan(shipment: Row) {
    if (!ctx.selectWork({ kind: "shipment", id: shipment.id })) return;
    ctx.navigate("loading");
  }
  function openBilling(shipment: Row) {
    if (!ctx.selectWork({ kind: "shipment", id: shipment.id })) return;
    ctx.navigate("billing");
  }
  function startAnotherOrder() {
    const next = new URL(window.location.href);
    next.searchParams.set("newOrder", "1");
    window.history.replaceState(null, "", next.pathname + next.search + next.hash);
    ctx.navigate("orders");
  }

  let step = 1, title = "Choose an order", detail = "Pick the customer order you are preparing.";
  let button = "Choose an order", action = () => ctx.navigate("orders");
  if (order) {
    if (!manifests.length) {
      step = 1; title = "Add box contents"; detail = "Set the number of boxes, products and quantities per box. Mixed products can go in the same box."; button = "Continue: box contents"; action = openPacking;
    } else if (manifests.some((item) => item.state === "Draft")) {
      const draft = manifests.find((item) => item.state === "Draft")!;
      step = 2; title = "Prepare labels for this saved order"; detail = "This older order already has a saved box plan. Prepare its labels to continue."; button = "Continue: labels";
      action = () => { void (async () => { await ctx.run("approveManifest", { id: draft.id, physicalConfirmed: true }); if (!ctx.selectWork({ kind: "packing", id: draft.id })) return; ctx.navigate("printLabels"); })(); };
    } else if (!cartonsReady) {
      step = 2; title = "Prepare box labels"; detail = "Print the labels, attach each label to its matching box, then confirm the check."; button = "Continue: labels"; action = openLabels;
    } else if (pendingShipment) {
      step = 3; title = "Scan boxes as they load"; detail = "The shipment is prepared automatically. Scan each box once and wait for its saved confirmation."; button = "Continue: scan boxes"; action = () => openScan(pendingShipment);
    } else if (remaining > 0) {
      step = 3; title = "Prepare boxes for scanning"; detail = "The order is checked and labeled. Prepare its remaining boxes for loading."; button = "Continue: scan boxes"; action = () => { void (async () => { await ctx.run("prepareOrderShipment", { id: order.id }); await ctx.refresh(); })(); };
    } else if (latestShipment && orderBillingComplete) {
      step = 4; title = "Order complete"; detail = "All shipment invoices are confirmed in Tally. You can review or print them from Billing."; button = "View invoices"; action = () => openBilling(latestShipment);
    } else if (latestShipment) {
      const shipmentToBill = [...shipments].reverse().find((shipment) => !confirmedInvoiceShipmentIds.has(shipment.id)) ?? latestShipment;
      step = 4; title = "Finish the bill"; detail = "Review this shipment’s bill and create its sales invoice in Tally."; button = "Continue: billing"; action = () => openBilling(shipmentToBill);
    }
  }
  const stepNames = ["Order & boxes", "Labels", "Scan", "Bill"];
  return <section className="dispatch-guide">
    <div className="dispatch-guide-heading"><span className="eyebrow">ELECTRO GROUP OF INDUSTRIES</span><h1>Dispatch an order</h1><p>Choose the customer and set the box contents together. We’ll carry the details through loading and billing.</p></div>
    <div className="dispatch-guide-steps" aria-label={orderBillingComplete ? "All 4 steps complete" : `Step ${step} of 4`}>
      {stepNames.map((name, i) => <span key={name} className={orderBillingComplete || i + 1 < step ? "complete" : i + 1 === step ? "current" : ""}><b>{i + 1}</b>{name}</span>)}
    </div>
    {!orders.length ? <section className="dispatch-guide-card"><h2>Start with a customer order</h2><p>Add the order once; the customer, delivery details and requested items will carry forward.</p><button className="primary" onClick={startAnotherOrder}><Plus size={17} />New customer order</button></section> : <section className="dispatch-guide-card">
      <div className="dispatch-order-toolbar"><label className="dispatch-order-choice"><span>Customer order</span><select value={orderId} onChange={(e) => rememberOrder(e.target.value)}><option value="">Choose an order</option>{openOrders.map((item) => <option value={item.id} key={item.id}>{item.reference} · {ctx.all.customers.find((customer) => customer.id === item.customerId)?.name ?? "Customer"}</option>)}</select></label><button className="secondary" onClick={startAnotherOrder}><Plus size={17} />Start another order</button></div>
      {order ? <div className="dispatch-order-summary"><strong>{ctx.all.customers.find((customer) => customer.id === order.customerId)?.name}</strong><span>{order.reference}</span><span>{order.destination}</span><span>{order.expectedCartons} boxes</span></div> : <p>Choose the order you want to prepare.</p>}
      <div className="dispatch-guide-next"><div><span>STEP {step} OF 4</span><h2>{title}</h2><p>{detail}</p></div><button className="primary" disabled={!order || (manifests.some((item) => item.state === "Draft") && !ctx.user.roles.some((role: string) => ["Admin", "PackingSupervisor"].includes(role)))} onClick={action}>{button}<ArrowRight size={17} /></button></div>
      {!openOrders.length && <p>There are no open orders. Start a new order above or review the order history in Orders.</p>}
    </section>}
  </section>;
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
