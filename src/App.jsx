import { useMemo, useState, lazy, Suspense } from "react";
import "./App.css";

const Plot = lazy(() => import("react-plotly.js"));

/* -------------------- constants -------------------- */

const AXES = [
  { key: "roll", label: "Roll", color: "#ef4444" },
  { key: "pitch", label: "Pitch", color: "#22c55e" },
  { key: "yaw", label: "Yaw", color: "#3b82f6" },
];

/* -------------------- helpers -------------------- */

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
    "time_s",
    "time_us",
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

  return { time, gyro, setpoint };
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

function inferTimeScaleToSeconds(t) {
  // Returns: {tSec, dtSec, unitLabel}
  // iNav blackbox records time in microseconds (often) [2](https://github.com/iNavFlight/inav/blob/master/docs/Blackbox.md)
  const tt = t.filter(isFiniteNum);
  if (tt.length < 5) return { tSec: null, dtSec: null, unitLabel: "samples" };

  const dts = [];
  for (let i = 1; i < tt.length; i++) {
    const dt = tt[i] - tt[i - 1];
    if (dt > 0 && Number.isFinite(dt)) dts.push(dt);
  }
  const dtMed = median(dts);

  // Heuristics:
  // - microseconds: dt around 100..5000, time grows to big numbers
  // - milliseconds: dt around 1..20
  // - seconds: dt around 0.001..0.02 etc
  let scale = 1; // to seconds
  let unitLabel = "time";

  if (dtMed > 50 && dtMed < 20000) {
    // likely microseconds
    scale = 1e-6;
    unitLabel = "s (from µs)";
  } else if (dtMed >= 0.5 && dtMed <= 50) {
    // likely milliseconds
    scale = 1e-3;
    unitLabel = "s (from ms)";
  } else if (dtMed > 0 && dtMed < 0.5) {
    // already seconds-like
    scale = 1;
    unitLabel = "s";
  } else {
    // fallback
    scale = 1;
    unitLabel = "time";
  }

  const tSec = tt.map((v) => v * scale);
  const dtSec = dtMed * scale;
  return { tSec, dtSec, unitLabel };
}

function rms(arr) {
  const v = arr.filter(isFiniteNum);
  if (!v.length) return 0;
  return Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
}

/**
 * Detect steps in setpoint and compute step-response metrics.
 * - rise time: 10% -> 90% of step size (definition) [1](https://pressbooks.library.torontomu.ca/controlsystems/chapter/4-3-step-response-specifications-definitions/)
 * - settling time: time until within ±5% band (definition) [1](https://pressbooks.library.torontomu.ca/controlsystems/chapter/4-3-step-response-specifications-definitions/)
 * - overshoot: percent over final value relative to step size (definition) [1](https://pressbooks.library.torontomu.ca/controlsystems/chapter/4-3-step-response-specifications-definitions/)
 */
function stepResponseMetrics(tSec, sp, gy, dtSec) {
  const n = Math.min(sp.length, gy.length, tSec.length);
  if (n < 50 || !dtSec || !Number.isFinite(dtSec)) return null;

  const spN = sp.slice(0, n);
  const gyN = gy.slice(0, n);
  const tN = tSec.slice(0, n);

  // Determine a reasonable threshold for detecting a step:
  const spAbsMax = Math.max(...spN.map((v) => (isFiniteNum(v) ? Math.abs(v) : 0)));
  const stepThreshold = Math.max(5, 0.08 * spAbsMax); // deg/s-ish heuristic

  const stepIdx = [];
  for (let i = 1; i < n; i++) {
    const a = spN[i - 1];
    const b = spN[i];
    if (!isFiniteNum(a) || !isFiniteNum(b)) continue;
    if (Math.abs(b - a) >= stepThreshold) stepIdx.push(i);
  }

  // de-bounce: keep steps at least 0.2s apart
  const minGap = Math.max(1, Math.floor(0.2 / dtSec));
  const filtered = [];
  for (const i of stepIdx) {
    if (!filtered.length || i - filtered[filtered.length - 1] >= minGap) filtered.push(i);
  }

  if (!filtered.length) return { steps: 0 };

  const maxSteps = 5; // keep it fast and stable
  const steps = filtered.slice(0, maxSteps);

  const overs = [];
  const rise = [];
  const settle = [];
  const sse = [];

  const windowSec = 1.0;
  const windowN = Math.max(20, Math.floor(windowSec / dtSec));
  const settleBand = 0.05; // ±5% band

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

    // Targets for 10% and 90%
    const y10 = sp0 + 0.10 * delta;
    const y90 = sp0 + 0.90 * delta;

    // Rise time
    let t10 = null, t90 = null;
    for (let k = 0; k < y.length; k++) {
      const val = y[k];
      if (!isFiniteNum(val)) continue;
      // direction-aware threshold crossing:
      if (delta > 0) {
        if (t10 === null && val >= y10) t10 = tt[k];
        if (t90 === null && val >= y90) t90 = tt[k];
      } else {
        if (t10 === null && val <= y10) t10 = tt[k];
        if (t90 === null && val <= y90) t90 = tt[k];
      }
      if (t10 !== null && t90 !== null) break;
    }
    if (t10 !== null && t90 !== null && t90 >= t10) {
      rise.push((t90 - t10) * 1000); // ms
    }

    // Overshoot (%)
    let peak = null;
    for (let k = 0; k < y.length; k++) {
      const val = y[k];
      if (!isFiniteNum(val)) continue;
      if (peak === null) peak = val;
      if (delta > 0) peak = Math.max(peak, val);
      else peak = Math.min(peak, val);
    }
    if (peak !== null) {
      const ov = delta > 0 ? (peak - spF) : (spF - peak);
      overs.push(Math.max(0, (ov / mag) * 100));
    }

    // Settling time: first time after step when it stays within band for the rest of the window
    const band = mag * settleBand;
    let tSet = null;
    for (let k = 0; k < y.length; k++) {
      const val = y[k];
      if (!isFiniteNum(val)) continue;
      if (Math.abs(val - spF) <= band) {
        // ensure it stays in band for remaining samples
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
    if (tSet !== null) {
      settle.push((tSet - tN[start]) * 1000); // ms from step moment
    }

    // Steady-state error: mean of last 15% of window
    const tailStart = Math.floor(y.length * 0.85);
    const tail = y.slice(tailStart).filter(isFiniteNum);
    if (tail.length) {
      const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
      sse.push(mean - spF);
    }
  }

  // Summaries
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  return {
    steps: steps.length,
    rise_ms: avg(rise),
    settle_ms: avg(settle),
    overshoot_pct: avg(overs),
    steady_state_error: avg(sse),
  };
}

/**
 * Estimate tracking delay (ms) via cross-correlation of derivatives.
 * Finds lag maximizing correlation between d(setpoint) and d(gyro).
 */
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

  // Normalize
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const m1 = mean(dsp), m2 = mean(dgy);
  const x = dsp.map((v) => v - m1);
  const y = dgy.map((v) => v - m2);

  const maxLag = Math.min(200, Math.floor(0.25 / dtSec)); // up to 250ms window
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

/* -------------------- component -------------------- */

export default function App() {
  const [fileInfo, setFileInfo] = useState(null);
  const [error, setError] = useState("");

  const [timeCol, setTimeCol] = useState("");
  const [gyroCols, setGyroCols] = useState([]);
  const [setpointCols, setSetpointCols] = useState([]);

  const [axesOn, setAxesOn] = useState({ roll: true, pitch: true, yaw: true });

  const [showSetpoint, setShowSetpoint] = useState(true);
  const [maxPoints, setMaxPoints] = useState(20000);

  function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a CSV file (Blackbox CSV export).");
      setFileInfo(null);
      setTimeCol("");
      setGyroCols([]);
      setSetpointCols([]);
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
        setShowSetpoint((guessed.setpoint || []).length > 0);
      } catch {
        setError("Failed to parse CSV. Please export again from Blackbox Explorer.");
        setFileInfo(null);
      }
    };

    reader.readAsText(file);
  }

  const canPlot = !!fileInfo && !!timeCol && gyroCols.length > 0;

  // Traces for plot (downsampled)
  const plotData = useMemo(() => {
    if (!canPlot) return [];

    const xAll = fileInfo.rows.map((r) => r[timeCol]).filter((v) => v !== null && v !== undefined);
    const traces = [];

    AXES.forEach((axis, i) => {
      if (!axesOn[axis.key]) return;

      const g = gyroCols[i];
      if (g) {
        const yAll = fileInfo.rows.map((r) => r[g]);
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

      if (showSetpoint && setpointCols[i]) {
        const s = setpointCols[i];
        const yAll = fileInfo.rows.map((r) => r[s]);
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
    });

    return traces;
  }, [fileInfo, timeCol, gyroCols, setpointCols, axesOn, maxPoints, showSetpoint, canPlot]);

  // Metrics per axis (computed on downsampled vectors for speed)
  const metricsByAxis = useMemo(() => {
    if (!canPlot || !fileInfo) return null;

    const xAll = fileInfo.rows.map((r) => r[timeCol]).filter(isFiniteNum);
    const { tSec, dtSec, unitLabel } = inferTimeScaleToSeconds(xAll);

    const out = { unitLabel, axes: {} };

    AXES.forEach((axis, i) => {
      const gCol = gyroCols[i];
      const sCol = setpointCols[i];
      if (!gCol || !sCol || !tSec || !dtSec) return;

      const gy = fileInfo.rows.map((r) => r[gCol]).filter(isFiniteNum);
      const sp = fileInfo.rows.map((r) => r[sCol]).filter(isFiniteNum);

      // Align lengths to time
      const n = Math.min(tSec.length, gy.length, sp.length);
      const t = tSec.slice(0, n);
      const gyN = gy.slice(0, n);
      const spN = sp.slice(0, n);

      // Downsample all to match maxPoints (metrics keep enough fidelity)
      const dsG = downsampleXY(t, gyN, maxPoints);
      const dsS = downsampleXY(t, spN, maxPoints);

      const step = stepResponseMetrics(dsS.x, dsS.y, dsG.y, dtSec);
      const lag = trackingDelayMs(dsS.x, dsS.y, dsG.y, dtSec);

      // Noise RMS at low setpoint
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
  }, [canPlot, fileInfo, timeCol, gyroCols, setpointCols, maxPoints]);

  return (
    <div className="app">
      <header className="header">
        <h1>iNav PID Analyzer</h1>
        <p>Gyro vs Setpoint • Roll / Pitch / Yaw + Step-response metrics</p>
      </header>

      <main className="main">
        <section className="upload-card">
          <h2>Upload CSV</h2>
          <p style={{ marginTop: 0, color: "#6b7280" }}>
            Blackbox logs record time (often in microseconds), RC command/setpoint, gyro, and PID terms [2](https://github.com/iNavFlight/inav/blob/master/docs/Blackbox.md)[3](https://deepwiki.com/iNavFlight/inav/6.1-blackbox-flight-data-logging)
          </p>

          <input type="file" accept=".csv" onChange={handleFileUpload} />
          {error && <p className="error">{error}</p>}

          <div style={{ marginTop: 12 }}>
            {AXES.map((a) => (
              <label key={a.key} style={{ marginRight: 12 }}>
                <input
                  type="checkbox"
                  checked={axesOn[a.key]}
                  onChange={(e) => setAxesOn({ ...axesOn, [a.key]: e.target.checked })}
                />{" "}
                {a.label}
              </label>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={showSetpoint}
                onChange={(e) => setShowSetpoint(e.target.checked)}
              />{" "}
              Show setpoint overlay (dashed)
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            Downsample:&nbsp;
            <select value={maxPoints} onChange={(e) => setMaxPoints(+e.target.value)}>
              <option value={5000}>5k</option>
              <option value={10000}>10k</option>
              <option value={20000}>20k</option>
              <option value={50000}>50k</option>
            </select>
          </div>

          {fileInfo && (
            <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
              <div><strong>File:</strong> {fileInfo.name}</div>
              <div><strong>Rows:</strong> {fileInfo.rows.length}</div>
            </div>
          )}
        </section>

        <section className="empty-state">
          {!fileInfo && <p>Upload a CSV file to start analysis.</p>}

          {fileInfo && (
            <div style={{ width: "100%" }}>
              <h3>Column selection</h3>

              <div style={{ marginBottom: 12 }}>
                <label>
                  Time:&nbsp;
                  <select value={timeCol} onChange={(e) => setTimeCol(e.target.value)}>
                    <option value="">-- select --</option>
                    {fileInfo.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label>
                  Gyro (solid):<br />
                  <select
                    multiple
                    style={{ width: "100%", height: 110 }}
                    value={gyroCols}
                    onChange={(e) => setGyroCols(Array.from(e.target.selectedOptions).map((o) => o.value))}
                  >
                    {fileInfo.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label>
                  Setpoint (dashed):<br />
                  <select
                    multiple
                    style={{ width: "100%", height: 110 }}
                    value={setpointCols}
                    onChange={(e) => setSetpointCols(Array.from(e.target.selectedOptions).map((o) => o.value))}
                  >
                    {fileInfo.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              </div>

              {canPlot && (
                <Suspense fallback={<p>Loading chart…</p>}>
                  <Plot
                    data={plotData}
                    layout={{
                      title: "Gyro vs Setpoint Overlay",
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

              {metricsByAxis && (
                <div style={{ marginTop: 16, fontSize: 14 }}>
                  <h3>Step-response metrics</h3>
                  <p style={{ color: "#6b7280", marginTop: 0 }}>
                    Rise time (10→90%), settling time (±5%), and overshoot are standard step-response specs [1](https://pressbooks.library.torontomu.ca/controlsystems/chapter/4-3-step-response-specifications-definitions/)
                  </p>

                  {AXES.map((a) => {
                    const m = metricsByAxis.axes[a.key];
                    if (!m) return (
                      <div key={a.key} style={{ marginBottom: 10 }}>
                        <strong style={{ color: a.color }}>{a.label}</strong>: (missing gyro or setpoint columns)
                      </div>
                    );

                    return (
                      <div key={a.key} style={{ marginBottom: 10 }}>
                        <strong style={{ color: a.color }}>{a.label}</strong>{" "}
                        — Steps: {m.steps} | Lag: {m.lag_ms?.toFixed?.(1) ?? "n/a"} ms | Noise RMS: {m.noise_rms.toFixed(2)}
                        <br />
                        Rise: {m.rise_ms ? `${m.rise_ms.toFixed(1)} ms` : "n/a"} | Settle: {m.settle_ms ? `${m.settle_ms.toFixed(1)} ms` : "n/a"} | Overshoot: {m.overshoot_pct ? `${m.overshoot_pct.toFixed(1)}%` : "n/a"} | SSE: {m.sse ? m.sse.toFixed(2) : "n/a"}
                      </div>
                    );
                  })}
                </div>
              )}

              {!canPlot && (
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  Select a time column and at least one gyro signal to display the plot.
                </div>
              )}
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
