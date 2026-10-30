import { useEffect, useState, useCallback, type ReactNode } from "react";
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
import { LoadingScreen } from "./scanner";
import { brand, plainLabel } from "./brand";
import "./style.css";
export type Context = {
  s: State;
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
  ["packing", "Packing", Package],
  ["cartons", "Cartons & labels", ClipboardCheck],
  ["trips", "Trips & customers", Truck],
  ["loading", "Load cartons", ScanLine],
  ["billing", "Billing & Tally", ReceiptText],
  ["returns", "Returns", RotateCcw],
  ["reports", "Reports", Activity],
  ["setup", "Settings", Settings],
] as const;
function savedPage() {
  const page = window.location.hash.slice(1);
  return nav.some(([id]) => id === page) ? page : "overview";
}
export function App() {
  const [user, setUser] = useState<Row | null>(null),
    [s, setState] = useState<State | null>(null),
    [sample, setSample] = useState(false),
    [page, setPage] = useState(savedPage),
    [sessionStatus, setSessionStatus] = useState<"checking" | "ready" | "signedOut" | "unavailable">("checking"),
    [restoreAttempt, setRestoreAttempt] = useState(0),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [lastSync, setLastSync] = useState<Date | null>(null);
  const refresh = useCallback(async () => {
    if (sample) return;
    try {
      const next = await client.state();
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
  }, [sample]);
  useEffect(() => {
    const controller = new AbortController();
    setSessionStatus("checking");
    async function restore() {
      try {
        const restoredUser = await client.me(controller.signal);
        const next = await client.state(controller.signal);
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
    const restorePage = () => setPage(savedPage());
    window.addEventListener("hashchange", restorePage);
    return () => window.removeEventListener("hashchange", restorePage);
  }, []);
  function navigate(next: string) {
    if (!nav.some(([id]) => id === next)) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search + "#" + next);
    setPage(next);
  }
  useEffect(() => {
    if (!user || sample) return;
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
  }, [user, sample, refresh]);
  async function run(type: string, data: Row) {
    if (sample)
      throw Error(
        "This is a sample. Sign in to save your work.",
      );
    setBusy(true);
    setError("");
    const request = client.envelope(type, data);
    try {
      const result = await client.send(request);
      await refresh().catch(() =>
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
    setSessionStatus("ready");
  }
  if (sessionStatus === "signedOut") return <Login onLogin={onLogin} preview={preview} />;
  if (sessionStatus !== "ready" || !user || !s) {
    return <SessionNotice unavailable={sessionStatus === "unavailable"} retry={() => setRestoreAttempt((n) => n + 1)} />;
  }
  const ctx: Context = { s, user, sample, run, refresh, navigate };
  const current = nav.find((x) => x[0] === page)!;
  const screens: Record<string, ReactNode> = {
    overview: <Overview {...ctx} />,
    packing: <PackingScreen {...ctx} />,
    cartons: <CartonScreen {...ctx} />,
    trips: <TripsScreen {...ctx} />,
    loading: <LoadingScreen {...ctx} />,
    billing: <BillingScreen {...ctx} />,
    returns: <ReturnsScreen {...ctx} />,
    reports: <ReportsScreen {...ctx} />,
    setup: <SetupScreen {...ctx} />,
  };
  return (
    <div className="app">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <div className="brand-mark">
            E
          </div>
          <div>
            {brand.shortName}<small>GROUP OF INDUSTRIES</small>
          </div>
        </a>
        <div className="workspace">
          <span className="workspace-icon">EG</span>
          <div>
            {brand.business}<small>Dispatch</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => {
                navigate(id);
                setMobile(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {page === id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connector-mini">
            <span className="dot amber" />
            <div>
              Tally connection
              <small>
                {s.connectors.some((c) => !c.revoked && c.lastSeen)
                  ? "Diagnostics available"
                  : "Setup required"}
              </small>
            </div>
            <ArrowUpRight size={16} />
          </div>
          <button
            className="profile"
            onClick={() => void logout()}
            disabled={busy}
          >
            <span className="avatar">{user.name[0]}</span>
            <div>
              {user.name}
              <small>{user.roles.map(plainLabel).join(" · ")}</small>
            </div>
            <LogOut size={15} />
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
            <span className="top-avatar">{user.name[0]}</span>
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
          {screens[page]}
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
            Record packed cartons, check labels, load the vehicle, and prepare billing.
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
        <p>Open your dispatch workspace.</p>
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
  const count = (state: string) => s.counts.find((x) => x.state === state)?.count ?? 0;
  return (
    <>
      <div className="page-heading">
        <div><h1>Home</h1><p>{brand.name} · Dispatch</p></div>
        <button className="primary" onClick={() => navigate("packing")}><Plus size={17} />Add packed cartons</button>
      </div>
      <div className="metrics">
        <Metric title="Total cartons" value={number(s.cartonTotal)} detail="Registered in this warehouse" icon={<Package />} />
        <Metric title="Available cartons" value={number(count("Available"))} detail="Check labels before reserving" icon={<Box />} />
        <Metric title="Loaded cartons" value={number(count("Loaded"))} detail="Waiting for departure" icon={<Truck />} />
        <Metric title="Lists to approve" value={number(s.manifests.filter((m) => m.state === "Draft").length)} detail="Supervisor check needed" icon={<ClipboardCheck />} />
      </div>
      <section className="panel daily-steps">
        <div className="panel-heading"><div><h2>What do you need to do?</h2><p>Follow these steps for each dispatch.</p></div></div>
        <div className="quick-actions">
          {[
            ["1", "Packing", "Add the cartons and what is inside.", "packing", Package],
            ["2", "Labels", "Print, attach, and check each label.", "cartons", ScanLine],
            ["3", "Trips & loading", "Choose a customer and vehicle, then scan the cartons.", "trips", Truck],
            ["4", "Billing", "Check prices and approve the bill.", "billing", ReceiptText],
          ].map(([n, title, detail, target, Icon]) => {
            const I = Icon as typeof Package;
            return <button key={String(n)} onClick={() => navigate(String(target))}><span className="step-count">{String(n)}</span><I size={22} /><strong>{String(title)}</strong><p>{String(detail)}</p><ArrowRight size={16} /></button>;
          })}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Recent packing lists</h2><p>Check the contents before printing labels.</p></div><button className="text-link" onClick={() => navigate("packing")}>View all <ArrowRight size={15} /></button></div>
        {s.manifests.length ? <div className="table-wrap"><table><thead><tr><th>PACKING LIST</th><th>CARTONS</th><th>STATUS</th><th /></tr></thead><tbody>{s.manifests.slice(0, 4).map((m) => <tr key={m.id}><td><strong>{m.name}</strong></td><td>{parse<Group[]>(m.groups).reduce((n, g) => n + g.count, 0)}</td><td><Badge tone={m.state === "Approved" ? "sage" : "amber"}>{m.state === "Draft" ? "Needs approval" : m.state}</Badge></td><td><button className="text-link" onClick={() => navigate("packing")} aria-label={"Open " + m.name}>Open <ArrowRight size={14} /></button></td></tr>)}</tbody></table></div> : <Empty title="No packing lists yet" detail="Add the packed cartons to get started." />}
      </section>
      <div className="notice amber"><ReceiptText size={18} /><div><strong>Tally setup is still needed.</strong> Packing and loading are available. Sending invoices to Tally stays off until your accountant checks the connection. <button className="text-link" onClick={() => navigate("setup")}>Open settings <ArrowRight size={14} /></button></div></div>
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
