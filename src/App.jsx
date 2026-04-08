import { useMemo, useState, lazy, Suspense } from "react";
import "./App.css";

const Plot = lazy(() => import("react-plotly.js"));

/* ---------------- constants ---------------- */

const AXES = [
  { key: "roll", label: "Roll", color: "#ef4444" },
  { key: "pitch", label: "Pitch", color: "#22c55e" },
  { key: "yaw", label: "Yaw", color: "#3b82f6" },
];

const PID_TERMS = [
  { key: "P", field: "pidP", dash: "dot" },
  { key: "I", field: "pidI", dash: "dash" },
  { key: "D", field: "pidD", dash: "dashdot" },
  { key: "FF", field: "pidFF", dash: "longdash" },
];

/* ---------------- helpers ---------------- */

function norm(h) {
  return String(h ?? "").trim();
}
function lower(headers) {
  return headers.map((h) => norm(h).toLowerCase());
}
function pickFirst(headers, candidates) {
  const l = lower(headers);
  for (const c of candidates) {
    const idx = l.indexOf(c.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  return "";
}
function pickIncludes(headers, patterns) {
  const l = lower(headers);
  const out = [];
  patterns.forEach((p) => {
    const idx = l.findIndex((h) => h.includes(p.toLowerCase()));
    if (idx !== -1) out.push(headers[idx]);
  });
  return [...new Set(out)];
}

function guessColumns(headers) {
  const time = pickFirst(headers, [
    "time",
    "time_us",
    "time_s",
    "timestamp",
    "loopiteration",
    "looptime",
    "t",
  ]);

  const gyro = pickIncludes(headers, [
    "gyro_roll",
    "gyro_pitch",
    "gyro_yaw",
    "gyroadc[0]",
    "gyroadc[1]",
    "gyroadc[2]",
    "gyro[0]",
    "gyro[1]",
    "gyro[2]",
    "gyrofilt[0]",
    "gyrofilt[1]",
    "gyrofilt[2]",
  ]).slice(0, 3);

  const setpoint = pickIncludes(headers, [
    "setpoint_roll",
    "setpoint_pitch",
    "setpoint_yaw",
    "setpoint[0]",
    "setpoint[1]",
    "setpoint[2]",
    "rccommand[0]",
    "rccommand[1]",
    "rccommand[2]",
    "rc_command[0]",
    "rc_command[1]",
    "rc_command[2]",
  ]).slice(0, 3);

  const pid = {};
  PID_TERMS.forEach((term) => {
    pid[term.key] = pickIncludes(headers, [
      `${term.field}[0]`,
      `${term.field}[1]`,
      `${term.field}[2]`,
      `${term.field.toLowerCase()}_roll`,
      `${term.field.toLowerCase()}_pitch`,
      `${term.field.toLowerCase()}_yaw`,
      `${term.field.toLowerCase()}term[0]`,
      `${term.field.toLowerCase()}term[1]`,
      `${term.field.toLowerCase()}term[2]`,
    ]).slice(0, 3);
  });

  return { time, gyro, setpoint, pid };
}

function downsampleXY(x, y, max = 20000) {
  const n = Math.min(x.length, y.length);
  if (n <= max) return { x: x.slice(0, n), y: y.slice(0, n) };
  const step = Math.ceil(n / max);
  const xs = [];
  const ys = [];
  for (let i = 0; i < n; i += step) {
    xs.push(x[i]);
    ys.push(y[i]);
  }
  if (xs[xs.length - 1] !== x[n - 1]) {
    xs.push(x[n - 1]);
    ys.push(y[n - 1]);
  }
  return { x: xs, y: ys };
}

function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function median(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// iNav Blackbox often logs time in microseconds [5](https://github.com/iNavFlight/inav/blob/master/docs/Blackbox.md)
function inferTimeScaleToSeconds(t) {
  const tt = t.filter(isFiniteNum);
  if (tt.length < 5) return { tSec: null, dtSec: null, unitLabel: "samples" };

  const dts = [];
  for (let i = 1; i < tt.length; i++) {
    const dt = tt[i] - tt[i - 1];
    if (dt > 0 && Number.isFinite(dt)) dts.push(dt);
  }
  const dtMed = median(dts);

  let scale = 1;
  let unitLabel = "s";

  if (dtMed > 50 && dtMed < 20000) {
    scale = 1e-6;
    unitLabel = "s (from µs)";
  } else if (dtMed >= 0.5 && dtMed <= 50) {
    scale = 1e-3;
    unitLabel = "s (from ms)";
  } else {
    scale = 1;
    unitLabel = "s";
  }

  return { tSec: tt.map((v) => v * scale), dtSec: dtMed * scale, unitLabel };
}

function rms(arr) {
  const v = arr.filter(isFiniteNum);
  if (!v.length) return 0;
  return Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
}

/**
 * Step-response metrics (standard definitions: overshoot, settling time, rise time). [1](https://pressbooks.library.torontomu.ca/controlsystems/chapter/4-3-step-response-specifications-definitions/)
 */
function stepResponseMetrics(tSec, sp, gy, dtSec) {
  const n = Math.min(sp.length, gy.length, tSec.length);
  if (n < 50 || !dtSec || !Number.isFinite(dtSec)) return null;

  const spN = sp.slice(0, n);
  const gyN = gy.slice(0, n);
  const tN = tSec.slice(0, n);

  const spAbsMax = Math.max(...spN.map((v) => (isFiniteNum(v) ? Math.abs(v) : 0)));
  const stepThreshold = Math.max(5, 0.08 * spAbsMax);

  const stepIdx = [];
  for (let i = 1; i < n; i++) {
    const a = spN[i - 1];
    const b = spN[i];
    if (!isFiniteNum(a) || !isFiniteNum(b)) continue;
    if (Math.abs(b - a) >= stepThreshold) stepIdx.push(i);
  }

  const minGap = Math.max(1, Math.floor(0.2 / dtSec));
  const filtered = [];
  for (const i of stepIdx) {
    if (!filtered.length || i - filtered[filtered.length - 1] >= minGap) filtered.push(i);
  }

  if (!filtered.length) return { steps: 0 };

  const steps = filtered.slice(0, 5);

  const overs = [];
  const rise = [];
  const settle = [];
  const sse = [];

  const windowSec = 1.0;
  const windowN = Math.max(20, Math.floor(windowSec / dtSec));
  const settleBand = 0.05;

  for (const idx of steps) {
    const start = idx;
    const end = Math.min(n - 1, idx + windowN);

    const sp0 = spN[idx - 1];
    const spF = spN[idx];
    if (!isFiniteNum(sp0) || !isFiniteNum(spF)) continue;

    const delta = spF - sp0;
    const mag = Math.abs(delta);
    if (mag < stepThreshold) continue;

    const y = gyN.slice(start, end + 1);
    const tt = tN.slice(start, end + 1);

    const y10 = sp0 + 0.1 * delta;
    const y90 = sp0 + 0.9 * delta;

    let t10 = null, t90 = null;
    for (let k = 0; k < y.length; k++) {
      const val = y[k];
      if (!isFiniteNum(val)) continue;
      if (delta > 0) {
        if (t10 === null && val >= y10) t10 = tt[k];
        if (t90 === null && val >= y90) t90 = tt[k];
      } else {
        if (t10 === null && val <= y10) t10 = tt[k];
        if (t90 === null && val <= y90) t90 = tt[k];
      }
      if (t10 !== null && t90 !== null) break;
    }
    if (t10 !== null && t90 !== null && t90 >= t10) rise.push((t90 - t10) * 1000);

    let peak = null;
    for (let k = 0; k < y.length; k++) {
      const val = y[k];
      if (!isFiniteNum(val)) continue;
      if (peak === null) peak = val;
      peak = delta > 0 ? Math.max(peak, val) : Math.min(peak, val);
    }
    if (peak !== null) {
      const ov = delta > 0 ? (peak - spF) : (spF - peak);
      overs.push(Math.max(0, (ov / mag) * 100));
    }

    const band = mag * settleBand;
    let tSet = null;
    for (let k = 0; k < y.length; k++) {
      const val = y[k];
      if (!isFiniteNum(val)) continue;
      if (Math.abs(val - spF) <= band) {
        let ok = true;
        for (let j = k; j < y.length; j++) {
          const vv = y[j];
          if (isFiniteNum(vv) && Math.abs(vv - spF) > band) {
            ok = false;
            break;
          }
        }
        if (ok) {
          tSet = tt[k];
          break;
        }
      }
    }
    if (tSet !== null) settle.push((tSet - tN[start]) * 1000);

    const tailStart = Math.floor(y.length * 0.85);
    const tail = y.slice(tailStart).filter(isFiniteNum);
    if (tail.length) {
      const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
      sse.push(mean - spF);
    }
  }

  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  return {
    steps: steps.length,
    rise_ms: avg(rise),
    settle_ms: avg(settle),
    overshoot_pct: avg(overs),
    steady_state_error: avg(sse),
  };
}

function trackingDelayMs(tSec, sp, gy, dtSec) {
  const n = Math.min(sp.length, gy.length, tSec.length);
  if (n < 100 || !dtSec || !Number.isFinite(dtSec)) return null;

  const dsp = [];
  const dgy = [];
  for (let i = 1; i < n; i++) {
    const a = sp[i - 1], b = sp[i];
    const c = gy[i - 1], d = gy[i];
    dsp.push(isFiniteNum(a) && isFiniteNum(b) ? (b - a) : 0);
    dgy.push(isFiniteNum(c) && isFiniteNum(d) ? (d - c) : 0);
  }

  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const m1 = mean(dsp), m2 = mean(dgy);
  const x = dsp.map((v) => v - m1);
  const y = dgy.map((v) => v - m2);

  const maxLag = Math.min(200, Math.floor(0.25 / dtSec));
  let bestLag = 0;
  let bestScore = -Infinity;

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0;
    let count = 0;
    for (let i = 0; i < x.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= y.length) continue;
      s += x[i] * y[j];
      count++;
    }
    if (count > 20 && s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }

  return bestLag * dtSec * 1000;
}

/* ---------------- warnings + recommendations ---------------- */

function generateWarnings(m) {
  const warnings = [];

  if (m.overshoot_pct != null && m.overshoot_pct >= 20) {
    warnings.push({ level: "error", code: "P_HIGH", text: `High overshoot (${m.overshoot_pct.toFixed(1)}%) → P too high` });
  }

  if (m.settle_ms != null && m.overshoot_pct != null && m.overshoot_pct > 5 && m.settle_ms > 350) {
    warnings.push({ level: "warn", code: "D_LOW", text: `Slow settling (${m.settle_ms.toFixed(0)} ms) → D too low` });
  }

  if (m.noise_rms != null && m.noise_rms > 15) {
    warnings.push({ level: "warn", code: "D_NOISE", text: `High noise (RMS ${m.noise_rms.toFixed(1)}) → D too high or filtering/motors` });
  }

  if (m.sse != null && Math.abs(m.sse) > 2) {
    warnings.push({ level: "info", code: "I_WINDUP", text: `Steady‑state error (${m.sse.toFixed(2)}) → possible I accumulation` });
  }

  if (m.lag_ms != null && Math.abs(m.lag_ms) > 40) {
    warnings.push({ level: "info", code: "LATENCY", text: `Tracking delay (${m.lag_ms.toFixed(1)} ms) → latency / filtering` });
  }

  return warnings;
}

/**
 * Recommendations are conservative multipliers.
 * They reflect standard PID behavior: P can cause overshoot/oscillation if too high,
 * D damps overshoot but can amplify noise, I removes steady-state error but can wind up. [2](https://deepwiki.com/iNavFlight/inav-configurator/4.2-pid-tuning-and-receiver-configuration)[3](https://chemicalengineeringsite.in/pid-controller-functioning-and-tuning-methods/)[4](https://pidexplained.com/how-to-tune-a-pid-controller/)
 */
function generateRecommendations(m, warnings) {
  // Multipliers start at 1.0 (no change)
  let p = 1.0, i = 1.0, d = 1.0, ff = 1.0;
  const reasons = [];

  const has = (code) => warnings.some(w => w.code === code);

  if (has("P_HIGH")) {
    // overshoot => reduce P a bit
    p *= 0.90;
    reasons.push("Reduce P ~10% to lower overshoot.");
  }

  if (has("D_LOW")) {
    // slow settling => increase D a bit
    d *= 1.10;
    reasons.push("Increase D ~10% to improve damping / settling.");
  }

  if (has("D_NOISE")) {
    // noise => reduce D slightly; suggest filtering
    d *= 0.90;
    reasons.push("Reduce D ~10% (and consider more filtering / mechanical noise sources).");
  }

  if (has("I_WINDUP")) {
    // persistent SSE => small I increase or decrease depends on sign? We keep conservative:
    // If SSE magnitude is high and settle is slow, avoid increasing I too much.
    if (m.settle_ms != null && m.settle_ms > 350) {
      i *= 0.95;
      reasons.push("SSE + slow settle: slightly reduce I (~5%) to avoid windup/oscillation.");
    } else {
      i *= 1.05;
      reasons.push("SSE present: slightly increase I (~5%) to reduce steady-state error.");
    }
  }

  if (has("LATENCY")) {
    // latency usually not solved by PID alone; recommend small FF increase (if used)
    ff *= 1.05;
    reasons.push("Latency detected: small FF increase (~5%) may improve stick tracking (also review filtering).");
  }

  // Clamp to sane bounds
  const clamp = (x) => Math.min(1.25, Math.max(0.75, x));
  p = clamp(p); i = clamp(i); d = clamp(d); ff = clamp(ff);

  // If no warnings, return empty recs
  if (!reasons.length) return { p: 1, i: 1, d: 1, ff: 1, reasons: ["No changes suggested (metrics look OK)."] };

  return { p, i, d, ff, reasons };
}

/* ---------------- component ---------------- */

export default function App() {
  const [fileInfo, setFileInfo] = useState(null);
  const [error, setError] = useState("");

  const [timeCol, setTimeCol] = useState("");
  const [gyroCols, setGyroCols] = useState([]);
  const [setpointCols, setSetpointCols] = useState([]);

  const [pidCols, setPidCols] = useState({ P: [], I: [], D: [], FF: [] });

  const [axesOn, setAxesOn] = useState({ roll: true, pitch: true, yaw: true });
  const [showSetpoint, setShowSetpoint] = useState(true);
  const [pidOn, setPidOn] = useState({ P: true, I: true, D: true, FF: false });

  const [maxPoints, setMaxPoints] = useState(20000);

  function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a CSV file (Blackbox CSV export).");
      setFileInfo(null);
      return;
    }
    setError("");

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          setError("CSV file is empty or invalid.");
          setFileInfo(null);
          return;
        }

        const headers = lines[0].split(",").map(norm);

        const rows = lines.slice(1).map((line) => {
          const values = line.split(",");
          const obj = {};
          headers.forEach((h, i) => {
            const raw = values[i] ?? "";
            const v = String(raw).trim();
            const n = Number(v);
            obj[h] = v === "" ? null : (Number.isFinite(n) ? n : v);
          });
          return obj;
        });

        const guessed = guessColumns(headers);

        setFileInfo({ name: file.name, headers, rows });
        setTimeCol(guessed.time || "");
        setGyroCols(guessed.gyro || []);
        setSetpointCols(guessed.setpoint || []);
        setPidCols(guessed.pid || { P: [], I: [], D: [], FF: [] });

        setShowSetpoint((guessed.setpoint || []).length > 0);
      } catch {
        setError("Failed to parse CSV.");
        setFileInfo(null);
      }
    };
    reader.readAsText(file);
  }

  const canPlot = !!fileInfo && !!timeCol && gyroCols.length > 0;

  const plotData = useMemo(() => {
    if (!canPlot) return [];

    const xAll = fileInfo.rows.map((r) => r[timeCol]).filter((v) => v !== null && v !== undefined);
    const traces = [];

    AXES.forEach((axis, i) => {
      if (!axesOn[axis.key]) return;

      // Gyro
      if (gyroCols[i]) {
        const yAll = fileInfo.rows.map((r) => r[gyroCols[i]]);
        const n = Math.min(xAll.length, yAll.length);
        const ds = downsampleXY(xAll.slice(0, n), yAll.slice(0, n), maxPoints);
        traces.push({
          x: ds.x,
          y: ds.y,
          type: "scatter",
          mode: "lines",
          name: `${axis.label} gyro`,
          line: { color: axis.color, width: 2 },
        });
      }

      // Setpoint
      if (showSetpoint && setpointCols[i]) {
        const yAll = fileInfo.rows.map((r) => r[setpointCols[i]]);
        const n = Math.min(xAll.length, yAll.length);
        const ds = downsampleXY(xAll.slice(0, n), yAll.slice(0, n), maxPoints);
        traces.push({
          x: ds.x,
          y: ds.y,
          type: "scatter",
          mode: "lines",
          name: `${axis.label} setpoint`,
          line: { color: axis.color, width: 2, dash: "dash" },
        });
      }

      // PID terms
      PID_TERMS.forEach((term) => {
        if (!pidOn[term.key]) return;
        const col = pidCols?.[term.key]?.[i];
        if (!col) return;

        const yAll = fileInfo.rows.map((r) => r[col]);
        const n = Math.min(xAll.length, yAll.length);
        const ds = downsampleXY(xAll.slice(0, n), yAll.slice(0, n), maxPoints);

        traces.push({
          x: ds.x,
          y: ds.y,
          type: "scatter",
          mode: "lines",
          name: `${axis.label} ${term.key}`,
          line: { color: axis.color, width: 1, dash: term.dash },
          opacity: 0.6,
        });
      });
    });

    return traces;
  }, [fileInfo, timeCol, gyroCols, setpointCols, pidCols, axesOn, showSetpoint, pidOn, maxPoints, canPlot]);

  const metricsByAxis = useMemo(() => {
    if (!fileInfo || !timeCol) return null;

    const tRaw = fileInfo.rows.map((r) => r[timeCol]).filter(isFiniteNum);
    const { tSec, dtSec, unitLabel } = inferTimeScaleToSeconds(tRaw);
    if (!tSec || !dtSec) return null;

    const out = { unitLabel, axes: {} };

    AXES.forEach((axis, i) => {
      const gCol = gyroCols[i];
      const sCol = setpointCols[i];
      if (!gCol || !sCol) return;

      const gy = fileInfo.rows.map((r) => r[gCol]).filter(isFiniteNum);
      const sp = fileInfo.rows.map((r) => r[sCol]).filter(isFiniteNum);
      const n = Math.min(tSec.length, gy.length, sp.length);

      const t = tSec.slice(0, n);
      const gyN = gy.slice(0, n);
      const spN = sp.slice(0, n);

      const dsG = downsampleXY(t, gyN, maxPoints);
      const dsS = downsampleXY(t, spN, maxPoints);

      const step = stepResponseMetrics(dsS.x, dsS.y, dsG.y, dtSec);
      const lag = trackingDelayMs(dsS.x, dsS.y, dsG.y, dtSec);

      const quiet = dsG.y.filter((_, idx) => Math.abs(dsS.y[idx] ?? 0) < 5);
      const noise = rms(quiet);

      out.axes[axis.key] = {
        steps: step?.steps ?? 0,
        rise_ms: step?.rise_ms ?? null,
        settle_ms: step?.settle_ms ?? null,
        overshoot_pct: step?.overshoot_pct ?? null,
        sse: step?.steady_state_error ?? null,
        lag_ms: lag,
        noise_rms: noise,
      };
    });

    return out;
  }, [fileInfo, timeCol, gyroCols, setpointCols, maxPoints]);

  const warningsAndRecsByAxis = useMemo(() => {
    const out = {};
    if (!metricsByAxis) return out;

    AXES.forEach((a) => {
      const m = metricsByAxis.axes?.[a.key];
      if (!m) return;
      const ws = generateWarnings(m);
      const rec = generateRecommendations(m, ws);
      out[a.key] = { m, ws, rec };
    });

    return out;
  }, [metricsByAxis]);

  return (
    <div className="app">
      <header className="header">
        <h1>iNav PID Analyzer</h1>
        <p>Warnings + Recommendations (rule-based)</p>
      </header>

      <main className="main">
        <section className="upload-card">
          <h2>Upload CSV</h2>
          <input type="file" accept=".csv" onChange={handleFileUpload} />
          {error && <p className="error">{error}</p>}

          <div style={{ marginTop: 10 }}>
            {AXES.map((a) => (
              <label key={a.key} style={{ marginRight: 10 }}>
                <input
                  type="checkbox"
                  checked={axesOn[a.key]}
                  onChange={(e) => setAxesOn({ ...axesOn, [a.key]: e.target.checked })}
                />{" "}
                {a.label}
              </label>
            ))}
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={showSetpoint}
                onChange={(e) => setShowSetpoint(e.target.checked)}
              />{" "}
              Show setpoint overlay
            </label>
          </div>

          <div style={{ marginTop: 10 }}>
            {PID_TERMS.map((p) => (
              <label key={p.key} style={{ marginRight: 10, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={pidOn[p.key]}
                  onChange={(e) => setPidOn({ ...pidOn, [p.key]: e.target.checked })}
                />{" "}
                {p.key}
              </label>
            ))}
          </div>

          <div style={{ marginTop: 10 }}>
            Downsample:&nbsp;
            <select value={maxPoints} onChange={(e) => setMaxPoints(+e.target.value)}>
              <option value={5000}>5k</option>
              <option value={10000}>10k</option>
              <option value={20000}>20k</option>
              <option value={50000}>50k</option>
            </select>
          </div>
        </section>

        <section className="empty-state">
          {!fileInfo && <p>Upload a CSV to start analysis.</p>}

          {fileInfo && (
            <div style={{ width: "100%" }}>
              <h3>Plot</h3>

              {canPlot && (
                <Suspense fallback={<p>Loading chart…</p>}>
                  <Plot
                    data={plotData}
                    layout={{
                      title: "Gyro / Setpoint / PID terms",
                      xaxis: { title: timeCol },
                      yaxis: { title: "Value" },
                      legend: { orientation: "h" },
                      margin: { t: 50, l: 50, r: 20, b: 40 },
                    }}
                    style={{ width: "100%", height: 520 }}
                    config={{ responsive: true }}
                  />
                </Suspense>
              )}

              <h3 style={{ marginTop: 18 }}>Metrics → Warnings → Recommendations</h3>
              <p style={{ marginTop: 0, color: "#6b7280" }}>
                P affects responsiveness/overshoot, I removes steady-state error, D damps overshoot but can amplify noise, FF improves stick response. [2](https://deepwiki.com/iNavFlight/inav-configurator/4.2-pid-tuning-and-receiver-configuration)[3](https://chemicalengineeringsite.in/pid-controller-functioning-and-tuning-methods/)[4](https://pidexplained.com/how-to-tune-a-pid-controller/)
              </p>

              {AXES.map((a) => {
                const pack = warningsAndRecsByAxis[a.key];
                if (!pack) {
                  return (
                    <div key={a.key} style={{ marginBottom: 14 }}>
                      <strong style={{ color: a.color }}>{a.label}</strong>: (missing metrics — select gyro+setpoint)
                    </div>
                  );
                }

                const { m, ws, rec } = pack;

                const pct = (mult) => `${mult >= 1 ? "+" : ""}${((mult - 1) * 100).toFixed(0)}%`;

                return (
                  <div key={a.key} style={{ marginBottom: 16 }}>
                    <strong style={{ color: a.color }}>{a.label}</strong>{" "}
                    <span style={{ color: "#6b7280" }}>
                      (steps={m.steps}, overshoot={m.overshoot_pct?.toFixed?.(1) ?? "n/a"}%, settle={m.settle_ms?.toFixed?.(0) ?? "n/a"} ms, noise={m.noise_rms?.toFixed?.(2)})
                    </span>

                    {/* Warnings */}
                    {ws.length > 0 ? (
                      <ul style={{ marginTop: 6, marginBottom: 6 }}>
                        {ws.map((w, i) => (
                          <li
                            key={i}
                            style={{
                              color:
                                w.level === "error"
                                  ? "#dc2626"
                                  : w.level === "warn"
                                  ? "#f59e0b"
                                  : "#2563eb",
                            }}
                          >
                            {w.text}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ color: "#16a34a", marginTop: 6 }}>
                        ✅ No issues detected
                      </div>
                    )}

                    {/* Recommendations */}
                    <div style={{ marginTop: 6 }}>
                      <strong>Suggested changes (conservative):</strong>{" "}
                      <span style={{ color: "#374151" }}>
                        P {pct(rec.p)} · I {pct(rec.i)} · D {pct(rec.d)} · FF {pct(rec.ff)}
                      </span>
                      <ul style={{ marginTop: 6, marginBottom: 0 }}>
                        {rec.reasons.map((t, i) => (
                          <li key={i} style={{ color: "#374151" }}>
                            {t}
                          </li>
                        ))}
                      </ul>
                      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                        Tip: Apply small changes one axis at a time; D reduces overshoot but can amplify noise, I can wind up. [3](https://chemicalengineeringsite.in/pid-controller-functioning-and-tuning-methods/)[2](https://deepwiki.com/iNavFlight/inav-configurator/4.2-pid-tuning-and-receiver-configuration)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <span>Beta • iNav 9.x</span>
      </footer>
    </div>
  );
}
