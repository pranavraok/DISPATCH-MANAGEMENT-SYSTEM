import { PhoneScanner } from "./phone-scanner";
import { useEffect, useRef, useState } from "react";
import {
  Volume2,
  ScanLine,
  WifiOff,
  Check,
  RefreshCw,
} from "lucide-react";
import { type Context, Badge, Field, Empty } from "./main";
import { date, totals, type Row } from "./domain";
import * as api from "./api";
import { plainLabel } from "./brand";
import { site } from "./site";
import { ShipmentChoices } from "./work-ui";
import { shortReference } from "./codes";
import { readWorkstation } from "./workstation";
import type { Workflow } from "./workflow";
type Result = { outcome: string; message: string; id?: string };
type Pending = { envelope: api.Envelope; shipmentId: string; at: string };
const pendingKey = "electro-group-uncertain-scan-v1";
const legacyPendingKey = "kriyantha-uncertain-scan-v1";
export function hasPendingScan() {
  try {
    const saved = JSON.parse(localStorage.getItem(site?.slug === "aromazon" ? "aromazen-uncertain-scan-v2" : pendingKey) ?? localStorage.getItem(legacyPendingKey) ?? "null");
    return !!saved?.envelope?.requestId;
  } catch { return false; }
}
export function pendingScanWorkflow(): Workflow {
  try {
    const saved = JSON.parse(localStorage.getItem(site?.slug === "aromazon" ? "aromazen-uncertain-scan-v2" : pendingKey) ?? localStorage.getItem(legacyPendingKey) ?? "null");
    return saved?.envelope?.data?.workflow === "OrderFirst" ? "OrderFirst" : "StockFirst";
  } catch { return "StockFirst"; }
}
export function DispatchScanScreen(ctx: Context) {
  const { all: s, sample, run, refresh } = ctx;
  const stockDispatch = site?.slug === "aromazon";
  const guided = ctx.workflow === "OrderFirst" || stockDispatch;
  const [camera, setCamera] = useState(false);
  const [shipmentId, setShipmentId] = useState(ctx.work.kind === "shipment" ? ctx.work.id : ""),
    [station, setStation] = useState(() => readWorkstation(s.company.id).station),
    [sessionId, setSessionId] = useState(""),
    [started, setStarted] = useState(false),
    [focused, setFocused] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [scan, setScan] = useState(""),
    [result, setResult] = useState<Result | null>(null),
    [events, setEvents] = useState<Row[]>([]),
    [pending, setPending] = useState<Pending | null>(() => {
      try {
        const saved = localStorage.getItem(site?.slug === "aromazon" ? "aromazen-uncertain-scan-v2" : pendingKey) ?? localStorage.getItem(legacyPendingKey);
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
    if (!started) return;
    // The scan field is disabled until `started` renders. Focus it after that render
    // so a keyboard-wedge scanner can send its first carton immediately.
    const frame = window.requestAnimationFrame(() => input.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [started]);
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
  function speak(kind: string, detail = "") {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return false;
    const words = kind === "Accepted"
      ? "Approved. This box is loaded. You can scan the next box."
      : kind === "Duplicate"
        ? "Already loaded. This box was counted before. Please take the next box."
        : kind === "Pending"
          ? "Please wait. I’m checking that scan. Don’t scan another box yet."
          : kind === "Ready"
            ? "Scanner ready. Scan each box once, and wait for my confirmation."
            : kind === "Test"
              ? "Dispatch scanner voice check. Audio is working. Please scan one box at a time."
              : detail.toLowerCase().includes("not reserved")
                ? "Rejected. This box isn’t assigned to the selected shipment. Please check the box label."
                : detail.toLowerCase().includes("invalid or wrong-company")
                  ? "Rejected. This QR code doesn’t match this company. Please scan the box label printed by Dispatch."
                  : detail.toLowerCase().includes("cannot be loaded")
                    ? "Rejected. This box needs a supervisor check. Please check its status and label."
                    : detail.toLowerCase().includes("paused")
                      ? "Rejected. Scanning is paused. Check the connection and selected shipment before continuing."
                      : "Rejected. This box wasn’t loaded. Please check its label and shipment.";
    try {
      const speech = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(words);
      const voices = speech.getVoices();
      const voice = voices.find((v) => /^en[-_]in$/i.test(v.lang))
        ?? voices.find((v) => /^en[-_]in/i.test(v.lang))
        ?? voices.find((v) => /^en[-_]/i.test(v.lang));
      utterance.lang = voice?.lang ?? "en-IN";
      if (voice) utterance.voice = voice;
      utterance.volume = 1;
      utterance.rate = 0.94;
      utterance.pitch = 1.02;
      speech.cancel();
      speech.speak(utterance);
      return true;
    } catch { return false; }
  }
  function sound(kind: string, detail = "") {
    // Use the browser/Windows speech voice for clear spoken confirmation.
    // Keep the existing tone only as a fallback on browsers without speech.
    if (speak(kind, detail)) return;
    const a = audio.current;
    if (!a || a.state !== "running") return;
    const patterns: Record<string, number[]> = {
      Accepted: [660, 880],
      Test: [660, 880],
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
      speak("Ready");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function store(p: Pending | null) {
    if (p) localStorage.setItem(site?.slug === "aromazon" ? "aromazen-uncertain-scan-v2" : pendingKey, JSON.stringify(p));
    else { localStorage.removeItem(site?.slug === "aromazon" ? "aromazen-uncertain-scan-v2" : pendingKey); localStorage.removeItem(legacyPendingKey); }
    setPending(p);
  }
  async function submit(qr: string) {
    if (stockDispatch && navigator.locks) {
      await navigator.locks.request("aromazen-dispatch-scan:" + s.company.id, { ifAvailable: true }, async lock => {
        if (!lock) { setError("Another tab is saving a scan. Wait for its result before scanning here."); return; }
        await submitUnlocked(qr);
      });
    } else await submitUnlocked(qr);
  }
  async function submitUnlocked(qr: string) {
    if (!qr.trim()) return;
    if (inflight.current || pending || (stockDispatch && hasPendingScan())) {
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
      sound("Rejected", "Loading is paused. Check connection, focus and the selected shipment.");
      return;
    }
    if (qr.length > 160) {
      setResult({ outcome: "Rejected", message: "This QR code is too long." });
      sound("Rejected", "This QR code is too long.");
      return;
    }
    const p: Pending = {
      envelope: api.envelope("scan", {
        workflow: ctx.workflow ?? "StockFirst",
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
      message: "Waiting for the server. Do not move to the next box.",
    });
    try {
      const r: Result = await api.send(p.envelope);
      const shown: Result = r.outcome === "Rejected" && r.message.includes("Invalid or wrong-company carton QR")
        ? { ...r, message: `${r.message} Scanner sent: ${JSON.stringify(qr.replace(/[\r\n]+$/, ""))}` }
        : r;
      store(null);
      setResult(shown);
      setEvents((prev) =>
        [{ ...shown, at: new Date().toISOString() }, ...prev].slice(0, 12),
      );
      sound(r.outcome, r.message);
      await refresh().catch(() => setError("This result is saved. Refresh the page to update the totals before continuing."));
    } catch (e) {
      if (stockDispatch && e instanceof api.ApiError && [400, 401, 403, 409, 410].includes(e.status)) {
        store(null); setStarted(false);
        setResult({ outcome: "Rejected", message: e.message }); setError(e.message);
        return;
      }
      setResult({
        outcome: "Pending",
        message:
          "Result not confirmed. Keep this box aside and check the saved result below.",
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
      sound(r.outcome, r.message);
      await refresh().catch(() => setError("This result is saved. Refresh the page to update the totals before continuing."));
    } catch (e) {
      setError(
        (e as Error).message +
          " Use Retry saved scan if no result was saved. You do not need to scan the box again.",
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
      sound(r.outcome, r.message);
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
          <h1>{guided ? "Scan boxes" : "Labels"}</h1>
          <p>{guided ? "Scan each box once as it is loaded for dispatch." : "Scan each box once here while loading it for dispatch."}</p>
        </div>
        <Badge tone={online ? "sage" : "red"}>
          {online ? "Browser online" : "Connection unavailable"}
        </Badge>
      </div>
      <section className="panel station-context">
        <Field label={guided ? "Shipment" : "Customer shipment"}>
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
        {!guided && <Field label="Workstation">
          <input
            value={station}
            disabled={started || !!pending}
            onChange={(e) => setStation(e.target.value)}
          />
        </Field>}
        <button
          className="primary"
          disabled={!!pending || sample || !shipmentId || !!shipment?.loadApproved}
          onClick={start}
        >
          <Volume2 size={18} />
              {guided ? "Start scanning" : "Start scanning & turn on voice"}
        </button>
      </section>
      {stockDispatch && <div className="button-row"><strong>Primary: 2D scanner</strong><button className="secondary" disabled={!started || !!pending || sample || !!shipment?.loadApproved} onClick={() => setCamera(true)}>Use phone camera</button><span>Phone scanning is optional.</span></div>}
      {camera && <PhoneScanner close={() => setCamera(false)} onScan={qr => { setCamera(false); void submit(qr); }} />}
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
                if (!speak("Test")) sound("Test");
                input.current?.focus();
              }}
            >
              Test voice <Volume2 size={15} />
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
              {guided ? "SCAN BOX LABEL" : "SCAN BOX QR"}
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
              placeholder={guided ? "Click here, then scan…" : "Click here, then scan a box…"}
              onPaste={(e) => {
                e.preventDefault();
                setError(
                  "Paste is blocked in live loading. Scan one physical box at a time.",
                );
              }}
            />
            <div className="scan-hint">
              {guided ? "Scan the QR label printed for this box by Dispatch. Product barcodes won’t identify a box. Wait for the spoken saved confirmation before the next box." : "Scan the box QR label printed by Dispatch. Product barcodes won’t identify a box. Wait for Loaded on screen and the spoken confirmation."}
            </div>
          </form>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {pending && (
            <div className="pending-recovery">
              <strong>Keep this box aside</strong>
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
              <h2>{stockDispatch ? "Cartons added to bill" : "Shipment progress"}</h2>
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
          <p>boxes loaded and saved</p>
          {shipment && <div className="scan-next-action">{shipment.loadApproved ? <button className="primary" onClick={() => ctx.navigate("billing")}>Review billing</button> : <button className="secondary" disabled={!!pending || allocations.length === 0 || loaded.length !== allocations.length || sample || !ctx.user.roles.some((role: string) => ["Admin", "DispatchSupervisor"].includes(role))} onClick={async () => {
            if (!window.confirm(stockDispatch ? "I checked that all scanned cartons are physically loaded for this customer. Finish loading and review the bill?" : "I checked that all reserved boxes are physically loaded for dispatch.")) return;
            try { await run("approveLoad", { id: shipment.id, physicalConfirmed: true }); setStarted(false); setResult(null); if (guided) ctx.navigate("billing"); }
            catch (e) { setError((e as Error).message); }
          }}>{guided ? "Finish loading" : "Approve load"}</button>}</div>}
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
            Item totals cover boxes shown on this page. Approval checks the full shipment.
          </div>
          {!guided && <div className="tally-meta">
            <span>Operator</span>
            <strong>{ctx.user.name}</strong>
          </div>}
          {!guided && <div className="tally-meta">
            <span>Station</span>
            <strong>{station}</strong>
          </div>}
          {!guided && <div className="tally-meta">
            <span>Receiver status</span>
            <strong>Check manually</strong>
          </div>}
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
                <th>BOX / MESSAGE</th>
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
