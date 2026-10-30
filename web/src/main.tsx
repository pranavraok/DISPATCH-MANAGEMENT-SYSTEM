import React, { useEffect, useState, useCallback, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
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
  return <span className={"badge " + tone}>{children}</span>;
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
  ["overview", "Overview", LayoutDashboard],
  ["packing", "Packed registration", Package],
  ["cartons", "Cartons & labels", ClipboardCheck],
  ["trips", "Dispatch trips", Truck],
  ["loading", "Loading station", ScanLine],
  ["billing", "Billing & Tally", ReceiptText],
  ["returns", "Returns & corrections", RotateCcw],
  ["reports", "Reports & audit", Activity],
  ["setup", "Settings & connections", Settings],
] as const;
function App() {
  const [user, setUser] = useState<Row | null>(null),
    [s, setState] = useState<State | null>(null),
    [sample, setSample] = useState(false),
    [page, setPage] = useState("overview"),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [lastSync, setLastSync] = useState<Date | null>(null);
  const refresh = useCallback(async () => {
    if (sample) return;
    const next = await client.state();
    setState(next);
    setLastSync(new Date());
  }, [sample]);
  useEffect(() => {
    client
      .me()
      .then((u) => {
        setUser(u);
        return client.state();
      })
      .then(setState)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!user || sample) return;
    const timer = setInterval(
      () =>
        refresh().catch(() =>
          setError(
            "Connection interrupted. Displayed data may be stale. Loading requires a confirmed server response.",
          ),
        ),
      15000,
    );
    return () => clearInterval(timer);
  }, [user, sample, refresh]);
  async function run(type: string, data: Row) {
    if (sample)
      throw Error(
        "Read-only sample. Sign in to the connected API to save changes.",
      );
    setBusy(true);
    setError("");
    const request = client.envelope(type, data);
    try {
      const result = await client.send(request);
      await refresh().catch(() =>
        setError("The change was saved. Refresh is unavailable; reload saved state before continuing."),
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
    const next = await client.state();
    setState(next);
    setLastSync(new Date());
  }
  function preview() {
    setSample(true);
    setUser({
      name: "Sample visitor",
      roles: ["MD"],
      email: "Read-only workspace",
    });
    setState(sampleState());
  }
  if (!user || !s) return <Login onLogin={onLogin} preview={preview} />;
  const ctx: Context = { s, user, sample, run, refresh, navigate: setPage };
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
            K<span>↗</span>
          </div>
          <div>
            KRIYANTHA<small>DISPATCH CONTROL</small>
          </div>
        </a>
        <div className="workspace">
          <span className="workspace-icon">KV</span>
          <div>
            KR Vishwanath<small>Agarbatti Works</small>
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
                setPage(id);
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
            onClick={() => {
              client.api("/auth/logout", { method: "POST" }).catch(() => {});
              setUser(null);
              setState(null);
              setSample(false);
            }}
          >
            <span className="avatar">{user.name[0]}</span>
            <div>
              {user.name}
              <small>{user.roles.join(" · ")}</small>
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
              Workspace <ChevronRight size={13} />
              <strong>{current[1]}</strong>
            </span>
          </div>
          <div className="top-actions">
            <span className={"connection " + (sample ? "muted" : "")}>
              <span className={"dot " + (sample ? "amber" : "green")} />
              {sample ? "Sample workspace" : "Server connected"}
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
                READ-ONLY SAMPLE · Fictional reference data. Changes are
                disabled; this is not a connected warehouse.
              </span>
              <button
                onClick={() => {
                  setUser(null);
                  setState(null);
                  setSample(false);
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
          <span>Built by Kriyantha Business Solutions</span>
          <span>
            {sample
              ? "Fictional data · No accounting activity"
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
      {busy && <div className="saving">Saving to server…</div>}
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
  const [email, setEmail] = useState("admin@kriyantha.test"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [connectionNote, setConnectionNote] = useState("");
  useEffect(() => {
    fetch("/api/health")
      .then((response) => {
        if (!response.ok)
          setConnectionNote(
            "The application is deployed. Its cloud database connection is awaiting setup approval. Use the read-only sample to review the workspace.",
          );
      })
      .catch(() =>
        setConnectionNote("Connection unavailable. Retry when the service is reachable."),
      );
  }, []);
  return (
    <div className="login">
      <section className="login-story">
        <a className="brand">
          <div className="brand-mark">
            K<span>↗</span>
          </div>
          <div>
            KRIYANTHA<small>BUSINESS SOLUTIONS</small>
          </div>
        </a>
        <div>
          <Badge tone="dark">PACKED. VERIFIED. DISPATCHED.</Badge>
          <h1>
            Every carton.
            <br />
            Accounted for.
          </h1>
          <p>
            One clear path from packed stock to the loading bay, with the right
            checks at every handover.
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
        <small>Purpose-built for KR Vishwanath Agarbatti Works</small>
      </section>
      <section className="login-form">
        <div className="eyebrow">DISPATCH CONTROL</div>
        <h2>Welcome back.</h2>
        {connectionNote && <div className="notice amber">{connectionNote}</div>}
        <p>Sign in to your warehouse workspace.</p>
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
            {busy ? "Signing in…" : "Sign in to workspace"}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="login-divider">EXPLORE FIRST</div>
        <button className="secondary wide" onClick={preview}>
          Open read-only sample <ArrowUpRight size={16} />
        </button>
        <div className="login-note">
          <ShieldCheck size={19} />
          <p>
            Account credentials come from your administrator. The sample
            contains fictional reference data and cannot post to Tally.
          </p>
        </div>
      </section>
    </div>
  );
}
function Overview(ctx: Context) {
  const { s, navigate } = ctx;
  const count = (state: string) =>
    s.counts.find((x) => x.state === state)?.count ?? 0;
  const cartons = s.cartons;
  const groups = s.manifests.flatMap((m) => parse<Group[]>(m.groups));
  const described = groups.reduce((n, g) => n + g.count, 0);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR OPERATIONS, AT A GLANCE</div>
          <h1>
            Dispatch overview<span className="heading-dot">.</span>
          </h1>
          <p>From packed stock to a verified departure.</p>
        </div>
        <button className="primary" onClick={() => navigate("packing")}>
          <Plus size={17} />
          Register packed stock
        </button>
      </div>
      <div className="metrics">
        <Metric
          title="Registered cartons"
          value={number(s.cartonTotal)}
          detail={
            described
              ? `${number(described)} described in recent manifests`
              : "Ready when you are"
          }
          icon={<Package />}
        />
        <Metric
          title="Available to allocate"
          value={number(count("Available"))}
          detail={`${cartons.filter((c) => c.verified && c.state === "Available").length} verified in current page`}
          icon={<Box />}
        />
        <Metric
          title="Currently loaded"
          value={number(count("Loaded"))}
          detail={`${s.trips.filter((t) => t.state === "Open").length} open vehicle trips`}
          icon={<Truck />}
        />
        <Metric
          title="Needs attention"
          value={number(
            s.jobs.filter((j) => j.state !== "Confirmed").length +
              s.manifests.filter((m) => m.state === "Draft").length,
          )}
          detail="Approvals & invoice exceptions"
          icon={<ClipboardCheck />}
          attention
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel journey-panel">
          <div className="panel-heading">
            <div>
              <h2>The dispatch path</h2>
              <p>A clear handover at every stage.</p>
            </div>
            <Badge tone="sage">Case 2 workflow</Badge>
          </div>
          <div className="journey">
            {[
              [
                "Register packed stock",
                "Capture the actual contents of each physical group.",
                "packing",
                Package,
              ],
              [
                "Label & verify",
                "Unique QRs, attached and physically checked.",
                "cartons",
                ScanLine,
              ],
              [
                "Allocate & load",
                "The right cartons, customer and vehicle.",
                "trips",
                Truck,
              ],
              [
                "Approve & invoice",
                "Reviewed billing, confirmed in Tally.",
                "billing",
                ReceiptText,
              ],
            ].map(([title, detail, target, Icon], i) => {
              const I = Icon as typeof Package;
              return (
                <button
                  key={String(title)}
                  onClick={() => navigate(String(target))}
                >
                  <span className="journey-icon">
                    <I size={20} />
                  </span>
                  <div>
                    <span className="step-number">0{i + 1}</span>
                    <h3>{String(title)}</h3>
                    <p>{String(detail)}</p>
                  </div>
                  <ArrowUpRight size={17} />
                </button>
              );
            })}
          </div>
          <div className="journey-note">
            <ShieldCheck size={17} />
            Acceptance is confirmed by the server. A scanner beep alone does not
            confirm loading.
          </div>
        </section>
        <section className="panel readiness">
          <div className="panel-heading">
            <div>
              <h2>Ready for your first load?</h2>
              <p>Keep the trial simple. Keep the checks real.</p>
            </div>
          </div>
          <div className="readiness-art">
            <div className="scan-corners">
              <Package size={55} strokeWidth={1} />
              <span className="scan-line" />
            </div>
            <span className="art-label">ONE CARTON. ONE IDENTITY.</span>
          </div>
          <div className="readiness-item">
            <span className="check-circle">
              <Check size={13} />
            </span>
            Unique carton identities
          </div>
          <div className="readiness-item">
            <span className="check-circle">
              <Check size={13} />
            </span>
            Mixed-product cartons supported
          </div>
          <div className="readiness-item">
            <span className="pending-circle">3</span>Pair Tally & validate
            invoice mapping
          </div>
          <button className="text-link" onClick={() => navigate("setup")}>
            Open connection setup <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <div className="dashboard-grid lower">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Recent packed manifests</h2>
              <p>Review contents before any labels are attached.</p>
            </div>
            <button className="text-link" onClick={() => navigate("packing")}>
              View all <ArrowUpRight size={15} />
            </button>
          </div>
          {s.manifests.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>MANIFEST</th>
                    <th>CARTONS</th>
                    <th>STATUS</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.manifests.slice(0, 4).map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.name}</strong>
                        <small>{m.id}</small>
                      </td>
                      <td>
                        {parse<Group[]>(m.groups).reduce(
                          (n, g) => n + g.count,
                          0,
                        )}
                      </td>
                      <td>
                        <Badge tone={m.state === "Approved" ? "sage" : "amber"}>
                          {m.state === "Draft" ? "Needs approval" : m.state}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          onClick={() => navigate("packing")}
                          aria-label={"Open " + m.name}
                        >
                          <ArrowUpRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Your first manifest starts here"
              detail="Register already-packed goods, then have a supervisor review them."
            />
          )}
        </section>
        <section className="panel tally-panel">
          <div className="panel-heading">
            <div>
              <h2>Tally & accounting</h2>
              <p>A separate, controlled handover.</p>
            </div>
            <span className="dot amber" />
          </div>
          <div className="tally-status">
            <ReceiptText size={24} />
            <div>
              <h3>Mapping needs validation</h3>
              <p>
                Operational work can continue. Invoice posting stays blocked
                until your actual accounting pattern is verified.
              </p>
            </div>
          </div>
          <div className="tally-meta">
            <span>Last stock sync</span>
            <strong>{date(s.mapping.syncedAt)}</strong>
          </div>
          <div className="tally-meta">
            <span>Posting jobs pending</span>
            <strong>
              {s.jobs.filter((j) => j.state !== "Confirmed").length}
            </strong>
          </div>
          <button
            className="secondary wide"
            onClick={() => navigate("billing")}
          >
            Review billing & connections <ArrowRight size={15} />
          </button>
        </section>
      </div>
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
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
