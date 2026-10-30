import { useEffect, useRef, useState } from "react";
import {
  Volume2,
  ScanLine,
  WifiOff,
  Check,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { type Context, Badge, Field, Empty } from "./main";
import { date, totals, type Row } from "./domain";
import * as api from "./api";
import { plainLabel } from "./brand";
import { ShipmentChoices } from "./work-ui";
import { shortReference } from "./codes";
type Result = { outcome: string; message: string; id?: string };
type Pending = { envelope: api.Envelope; shipmentId: string; at: string };
const pendingKey = "electro-group-uncertain-scan-v1";
const legacyPendingKey = "kriyantha-uncertain-scan-v1";
export function hasPendingScan() {
  try {
    const saved = JSON.parse(localStorage.getItem(pendingKey) ?? localStorage.getItem(legacyPendingKey) ?? "null");
    return !!saved?.envelope?.requestId;
  } catch { return false; }
}
export function DispatchScanScreen(ctx: Context) {
  const { all: s, sample, run, refresh } = ctx;
  const [shipmentId, setShipmentId] = useState(ctx.work.kind === "shipment" ? ctx.work.id : ""),
    [station, setStation] = useState("LOADING-PC-01"),
    [sessionId, setSessionId] = useState(""),
    [started, setStarted] = useState(false),
    [focused, setFocused] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [scan, setScan] = useState(""),
    [result, setResult] = useState<Result | null>(null),
    [events, setEvents] = useState<Row[]>([]),
    [pending, setPending] = useState<Pending | null>(() => {
      try {
        const saved = localStorage.getItem(pendingKey) ?? localStorage.getItem(legacyPendingKey);
        return JSON.parse(saved ?? "null");
      } catch {
        return null;
      }
    }),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    audio = useRef<AudioContext | null>(null),
    inflight = useRef(false);
  const shipment = s.shipments.find((x) => x.id === shipmentId);
  const allocations = s.allocations.filter(
    (x) => x.shipmentId === shipmentId && x.active,
  );
  const loaded = allocations.filter((x) => x.state === "Loaded");
  const contents = totals(
    s.cartons.filter((c) => loaded.some((a) => a.cartonId === c.id)),
  );
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    const session = s.loadingSessions.find(
      (x) => x.shipmentId === shipmentId && x.station === station,
    );
    if (session) setSessionId(session.id);
  }, [s.loadingSessions, shipmentId, station]);
  useEffect(() => {
    const warnPausedInput = (event: KeyboardEvent) => {
      if (started && (pending || !focused) && (event.key === 'Enter' || event.key.length === 1) && !event.ctrlKey && !event.metaKey) {
        setError('Scanning is paused or the scan box is not selected. Check any pending result, then select the scan box before continuing.');
      }
    };
    window.addEventListener('keydown', warnPausedInput, true);
    return () => window.removeEventListener('keydown', warnPausedInput, true);
  }, [started, pending, focused]);
  function sound(kind: string) {
    const a = audio.current;
    if (!a || a.state !== "running") return;
    const patterns: Record<string, number[]> = {
      Accepted: [660, 880],
      Duplicate: [440, 440],
      Rejected: [180, 120],
      Pending: [330],
    };
    (patterns[kind] ?? patterns.Rejected).forEach((f, i) => {
      const osc = a.createOscillator(),
        gain = a.createGain();
      osc.connect(gain);
      gain.connect(a.destination);
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.18, a.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        a.currentTime + i * 0.15 + 0.12,
      );
      osc.start(a.currentTime + i * 0.15);
      osc.stop(a.currentTime + i * 0.15 + 0.13);
    });
  }
  async function start() {
    setError("");
    try {
      if (pending)
        throw Error(
          "Check the previous scan result before starting or changing the shipment.",
        );
      if (sample) throw Error("The read-only sample cannot accept scans.");
      if (!shipmentId) throw Error("Select a customer shipment.");
      audio.current ??= new AudioContext();
      await audio.current.resume();
      const r = await run("startLoading", { shipmentId, station });
      setSessionId(r.id);
      setStarted(true);
      setResult(null);
      input.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function store(p: Pending | null) {
    if (p) localStorage.setItem(pendingKey, JSON.stringify(p));
    else { localStorage.removeItem(pendingKey); localStorage.removeItem(legacyPendingKey); }
    setPending(p);
  }
  async function submit(qr: string) {
    if (!qr.trim()) return;
    if (inflight.current || pending) {
      setError(
        "Scanning paused. Resolve the pending scan; no further input is accepted.",
      );
      sound("Pending");
      return;
    }
    if (
      !started ||
      !sessionId ||
      !shipmentId ||
      !online ||
      document.visibilityState !== "visible"
    ) {
      setResult({
        outcome: "Rejected",
        message:
          "Loading is paused. Check connection, focus and the selected shipment.",
      });
      sound("Rejected");
      return;
    }
    if (qr.length > 160) {
      setResult({ outcome: "Rejected", message: "This QR code is too long." });
      sound("Rejected");
      return;
    }
    const p: Pending = {
      envelope: api.envelope("scan", {
        sessionId,
        station,
        qr: qr.replace(/[\r\n]+$/, ""),
        mode: "live",
      }),
      shipmentId,
      at: new Date().toISOString(),
    };
    inflight.current = true;
    store(p);
    setResult({
      outcome: "Pending",
      message: "Waiting for the server. Do not move to the next carton.",
    });
    try {
      const r: Result = await api.send(p.envelope);
      store(null);
      setResult(r);
      setEvents((prev) =>
        [{ ...r, at: new Date().toISOString() }, ...prev].slice(0, 12),
      );
      sound(r.outcome);
      await refresh().catch(() => setError("This result is saved. Refresh the page to update the totals before continuing."));
    } catch (e) {
      setResult({
        outcome: "Pending",
        message:
          "Result not confirmed. Keep this carton aside and check the saved result below.",
      });
      sound("Pending");
      setError((e as Error).message);
    } finally {
      inflight.current = false;
      input.current?.focus();
    }
  }
  async function recover() {
    if (!pending) return;
    setError("");
    try {
      const r: Result = await api.reconcile(pending.envelope.requestId);
      setResult(r);
      store(null);
      setEvents((prev) =>
        [{ ...r, at: new Date().toISOString() }, ...prev].slice(0, 12),
      );
      sound(r.outcome);
      await refresh().catch(() => setError("This result is saved. Refresh the page to update the totals before continuing."));
    } catch (e) {
      setError(
        (e as Error).message +
          " Use Retry saved scan if no result was saved. You do not need to scan the carton again.",
      );
    }
  }
  async function retry() {
    if (!pending || inflight.current) return;
    inflight.current = true;
    try {
      const r = await api.send(pending.envelope);
      store(null);
      setResult(r);
      sound(r.outcome);
      await refresh().catch(() => setError("This result is saved. Refresh the page to update the totals before continuing."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inflight.current = false;
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Labels
          </h1>
          <p>Scan each carton once here while loading it onto the selected vehicle.</p>
        </div>
        <Badge tone={online ? "sage" : "red"}>
          {online ? "Browser online" : "Connection unavailable"}
        </Badge>
      </div>
      <div className="notice amber">
        <AlertTriangle size={18} />
        This is the only scanning step. Choose the customer shipment, then scan each carton as it goes onto the vehicle. Wait for Loaded on screen before moving to the next carton.
      </div>
      <section className="panel station-context">
        <Field label="Customer shipment">
          <select
            value={shipmentId}
            disabled={!!pending || inflight.current}
            onChange={(e) => {
              if (!ctx.selectWork(e.target.value ? { kind: "shipment", id: e.target.value } : { kind: "all" })) return;
              setShipmentId(e.target.value);
              setStarted(false);
              setSessionId("");
              setResult(null);
            }}
          >
            <option value="">Choose a shipment</option>
            <ShipmentChoices ctx={ctx} shipments={ctx.s.shipments.filter((x) => (!x.loadApproved || x.id === shipmentId) && x.state !== "Cancelled")} />
          </select>
        </Field>
        <Field label="Workstation">
          <input
            value={station}
            disabled={started || !!pending}
            onChange={(e) => setStation(e.target.value)}
          />
        </Field>
        <button
          className="primary"
          disabled={!!pending || sample || !shipmentId || !!shipment?.loadApproved}
          onClick={start}
        >
          <Volume2 size={18} />
          Start scanning & turn on sound
        </button>
      </section>
      <div className="scanner-layout">
        <section className="panel scanner-main">
          <div className="scanner-top">
            <span
              className={
                "dot " + (started && focused && !pending ? "green" : "amber")
              }
            />
            <strong>
              {pending
                ? "Paused: check last scan"
                : started
                  ? focused
                    ? "Scanner field ready"
                    : "Click the scan box to continue"
                  : shipment?.loadApproved ? "Load approved" : "Choose a shipment, then start scanning"}
            </strong>
            <button
              className="text-link"
              onClick={() => {
                sound("Accepted");
                input.current?.focus();
              }}
            >
              Test speaker <Volume2 size={15} />
            </button>
          </div>
          <div
            className={
              "scan-result " + (result?.outcome.toLowerCase() ?? "idle")
            }
            aria-live="assertive"
          >
            <ScanLine size={48} />
            <h2>{result ? plainLabel(result.outcome) : "Ready to scan"}</h2>
            <p>
              {result?.message ??
                (shipment?.loadApproved ? "This load is approved. Continue to Billing." : "Select your customer shipment and start scanning.")}
            </p>
            {result?.id && <code title={result.id}>{shortReference(result.id)}</code>}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = scan;
              setScan("");
              void submit(value);
            }}
          >
            <label className="scan-label" htmlFor="carton-scan">
              SCAN CARTON QR
            </label>
            <input
              id="carton-scan"
              ref={input}
              className="scan-input"
              value={scan}
              autoComplete="off"
              maxLength={161}
              disabled={!started || !!pending || !online || sample || !!shipment?.loadApproved}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => setScan(e.target.value)}
              placeholder="Click here, then scan a carton…"
              onPaste={(e) => {
                e.preventDefault();
                setError(
                  "Paste is blocked in live loading. Scan one physical carton at a time.",
                );
              }}
            />
            <div className="scan-hint">
              Enter saves the scan. Wait for Loaded on screen and the PC sound.
            </div>
          </form>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {pending && (
            <div className="pending-recovery">
              <strong>Keep this carton aside</strong>
              <p>
                Request {pending.envelope.requestId}
                <br />
                Original shipment: {pending.shipmentId} · {date(pending.at)}
              </p>
              <div className="button-row">
                <button className="secondary" onClick={recover}>
                  <RefreshCw size={16} />
                  Check saved result
                </button>
                <button className="secondary" onClick={retry}>
                  Retry saved scan
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="panel load-progress">
          <div className="panel-heading">
            <div>
              <h2>Shipment progress</h2>
              <p>
                {shipment
                  ? s.customers.find((c) => c.id === shipment.customerId)?.name
                  : "No shipment selected"}
              </p>
            </div>
          </div>
          <div className="load-big">
            {loaded.length}
            <span>/ {allocations.length}</span>
          </div>
          <p>cartons loaded and saved</p>
          {shipment && <div className="scan-next-action">{shipment.loadApproved ? <button className="primary" onClick={() => ctx.navigate("billing")}>Review billing</button> : <button className="secondary" disabled={!!pending || allocations.length === 0 || loaded.length !== allocations.length || sample || !ctx.user.roles.some((role: string) => ["Admin", "DispatchSupervisor"].includes(role))} onClick={async () => {
            if (!window.confirm("I checked that all reserved cartons are physically loaded on this vehicle.")) return;
            try { await run("approveLoad", { id: shipment.id, physicalConfirmed: true }); setStarted(false); setResult(null); }
            catch (e) { setError((e as Error).message); }
          }}>Approve load</button>}</div>}
          <div className="progress">
            <span
              style={{
                width:
                  (allocations.length
                    ? (loaded.length / allocations.length) * 100
                    : 0) + "%",
              }}
            />
          </div>
          <div className="station-totals">
            {contents.map((t) => (
              <div key={t.sku + t.unit}>
                <span>{t.sku}</span>
                <strong>
                  {t.quantity} {t.unit}
                </strong>
              </div>
            ))}
          </div>
          <div className="notice">
            Item totals cover cartons shown on this page. Approval checks the full shipment.
          </div>
          <div className="tally-meta">
            <span>Operator</span>
            <strong>{ctx.user.name}</strong>
          </div>
          <div className="tally-meta">
            <span>Station</span>
            <strong>{station}</strong>
          </div>
          <div className="tally-meta">
            <span>Receiver status</span>
            <strong>Check manually</strong>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent results</h2>
            <p>See Reports for the full scan history.</p>
          </div>
        </div>
        {events.length ? (
          <table>
            <thead>
              <tr>
                <th>RESULT</th>
                <th>CARTON / MESSAGE</th>
                <th>TIME</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td>
                    <Badge
                      tone={
                        e.outcome === "Accepted"
                          ? "sage"
                          : e.outcome === "Duplicate"
                            ? "amber"
                            : "red"
                      }
                    >
                      {plainLabel(e.outcome)}
                    </Badge>
                  </td>
                  <td>
                    <strong title={e.id}>{e.id ? shortReference(e.id) : e.message}</strong>
                    <small>{e.message}</small>
                  </td>
                  <td>{date(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title="No scans in this view"
            detail="Each scan result will appear here."
          />
        )}
      </section>
    </>
  );
}
