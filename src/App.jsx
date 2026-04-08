import { useEffect, useMemo, useState } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];
const AXIS_LABEL = { roll: "Roll", pitch: "Pitch", yaw: "Yaw" };
const FIRMWARES = ["ArduPilot", "iNav"];

const THEME_KEY = "pid-theme";
const FW_KEY = "pid-fw";

const FFT_WINDOW = 512;          // power of 2
const FFT_MIN_HZ = 20;
const FFT_MAX_HZ = 300;

/* ✅ NEW DEFAULT THRESHOLDS (Step 23 updated) */
const DEFAULT_VIB_WARN_RATIO = 2.5;
const DEFAULT_VIB_CRIT_RATIO = 5.0;

/* Firmware parameter mapping */
const PARAMS = {
  ArduPilot: {
    notchEnable: "INS_HNTCH_ENABLE",
    notchMode: "INS_HNTCH_MODE",
    notchFreq: "INS_HNTCH_FREQ",
    notchBW: "INS_HNTCH_BW",
    notchAtt: "INS_HNTCH_ATT",
    notchHmncs: "INS_HNTCH_HMNCS",
    rateP: (axis) =>
      axis === "roll" ? "ATC_RAT_RLL_P" : axis === "pitch" ? "ATC_RAT_PIT_P" : "ATC_RAT_YAW_P",
  },
  iNav: {
    notchEnable: "gyro_notch1_enabled",
    notchMode: "gyro_notch1_mode",
    notchFreq: "gyro_notch1_hz",
    notchBW: "gyro_notch1_cutoff",
    notchAtt: "gyro_notch1_att",
    notchHmncs: "gyro_notch1_harmonics",
    rateP: (axis) => `${axis}_p`,
  },
};

/* ================= THEME ================= */
function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/* ================= CSV PARSER ================= */
function parseCSV(file, onSuccess, onError) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const lines = String(r.result).split(/\r?\n/).filter((x) => x.trim().length);
      if (!lines.length) throw new Error("Empty file");

      const headerLine = lines[0];
      const delim = headerLine.includes(";") ? ";" : headerLine.includes("\t") ? "\t" : ",";
      const headers = headerLine.split(delim).map((h) => h.trim());

      const idx = (h) => headers.indexOf(h);
      const tIdx = idx("time");
      if (tIdx < 0) throw new Error('Missing required column: "time"');

      const gIdx = {
        roll: idx("gyro[0]"),
        pitch: idx("gyro[1]"),
        yaw: idx("gyro[2]"),
      };
      const sIdx = {
        roll: idx("setpoint[0]"),
        pitch: idx("setpoint[1]"),
        yaw: idx("setpoint[2]"),
      };

      if ([...Object.values(gIdx), ...Object.values(sIdx)].some((v) => v < 0)) {
        throw new Error('Missing required columns: gyro[0..2], setpoint[0..2]');
      }

      const data = lines.slice(1).map((line) => {
        const p = line.split(delim);
        return {
          time: Number(p[tIdx]),
          roll: { gyro: Number(p[gIdx.roll]), set: Number(p[sIdx.roll]) },
          pitch: { gyro: Number(p[gIdx.pitch]), set: Number(p[sIdx.pitch]) },
          yaw: { gyro: Number(p[gIdx.yaw]), set: Number(p[sIdx.yaw]) },
        };
      }).filter((r) => Number.isFinite(r.time));

      if (data.length < 10) throw new Error("Not enough rows");
      onSuccess(data);
    } catch (e) {
      onError(e.message || String(e));
    }
  };
  r.readAsText(file);
}

/* ================= NUM HELPERS ================= */
function median(arr) {
  const v = arr.slice().sort((a, b) => a - b);
  const n = v.length;
  if (!n) return 0;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

/* ================= FFT (Radix-2) ================= */
function hannWindow(N) {
  const w = new Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  return w;
}

function fftMagReal(signal) {
  const N = signal.length;
  const re = signal.slice();
  const im = new Array(N).fill(0);

  // bit-reverse
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const half = len >> 1;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < half; k++) {
        const cos = Math.cos(ang * k);
        const sin = Math.sin(ang * k);
        const tre = cos * re[i + k + half] - sin * im[i + k + half];
        const tim = sin * re[i + k + half] + cos * im[i + k + half];

        re[i + k + half] = re[i + k] - tre;
        im[i + k + half] = im[i + k] - tim;
        re[i + k] += tre;
        im[i + k] += tim;
      }
    }
  }

  const mags = new Array(N / 2);
  for (let i = 0; i < N / 2; i++) mags[i] = Math.hypot(re[i], im[i]) / N;
  return mags;
}

/* ================= STEP 23 ANALYSIS ================= */
function computeSampleRateHz(data) {
  const n = data.length;
  const take = Math.min(200, n - 1);
  const dts = [];
  for (let i = n - take; i < n; i++) {
    const dt = data[i].time - data[i - 1].time;
    if (dt > 0 && Number.isFinite(dt)) dts.push(dt);
  }
  const dtm = median(dts) || 0.002;
  return 1 / dtm;
}

function computeOvershootPct(gyroArr, setArr) {
  const setFinal = setArr[setArr.length - 1];
  if (!Number.isFinite(setFinal) || Math.abs(setFinal) < 1e-9) return null;
  const peak = Math.max(...gyroArr);
  return ((peak - setFinal) / Math.abs(setFinal)) * 100;
}

function computeAxisFFT(axisGyro, sampleRateHz) {
  if (axisGyro.length < FFT_WINDOW) return null;
  const w = hannWindow(FFT_WINDOW);
  const slice = axisGyro.slice(-FFT_WINDOW);
  const windowed = slice.map((v, i) => v * w[i]);
  const mags = fftMagReal(windowed);

  let bestI = -1;
  let bestMag = -1;
  const bandMags = [];
  const bandFreqs = [];

  for (let i = 1; i < mags.length; i++) {
    const f = (i * sampleRateHz) / FFT_WINDOW;
    if (f < FFT_MIN_HZ || f > FFT_MAX_HZ) continue;
    bandMags.push(mags[i]);
    bandFreqs.push(f);
    if (mags[i] > bestMag) { bestMag = mags[i]; bestI = i; }
  }
  if (bestI < 0) return null;

  const peakFreq = (bestI * sampleRateHz) / FFT_WINDOW;
  const noiseFloor = median(bandMags);
  const peakRatio = noiseFloor > 0 ? bestMag / noiseFloor : 0;

  return {
    peakFreq,
    peakMag: bestMag,
    noiseFloor,
    peakRatio,
    spectrum: bandFreqs.map((f, idx) => ({ f, m: bandMags[idx] })),
  };
}

function notchFromFFT(fft) {
  if (!fft) return null;
  const center = Math.round(fft.peakFreq);
  const bw = Math.round(clamp(center * 0.5, 30, 140));
  const harmonics = center < 150 ? 2 : 1;
  const att = 40;
  return { center, bw, harmonics, att };
}

function buildReport(data, vibWarnRatio, vibCritRatio) {
  const fs = computeSampleRateHz(data);
  const report = { fs, global: "OK", axes: {} };

  for (const axis of AXES) {
    const gyro = data.map((r) => r[axis].gyro);
    const set = data.map((r) => r[axis].set);

    const setFinal = set[set.length - 1];
    const inactive = !Number.isFinite(setFinal) || Math.abs(setFinal) < 1e-6;

    const overshootPct = inactive ? null : computeOvershootPct(gyro, set);
    const fft = computeAxisFFT(gyro, fs);
    const notch = notchFromFFT(fft);

    // base severity from overshoot
    let severity = "OK";
    if (!inactive && overshootPct != null) {
      if (overshootPct > 15) severity = "WARNING";
      if (overshootPct > 30) severity = "CRITICAL";
    }

    // ✅ NEW THRESHOLDS USED HERE
    const vibCritical = fft && fft.peakRatio >= vibCritRatio;
    const vibWarn = fft && fft.peakRatio >= vibWarnRatio;

    if (vibCritical) severity = "CRITICAL";
    else if (vibWarn && severity === "OK") severity = "WARNING";

    report.axes[axis] = {
      inactive,
      overshootPct: overshootPct != null ? Number(overshootPct.toFixed(1)) : null,
      fft: fft
        ? { peakFreq: Number(fft.peakFreq.toFixed(1)), peakRatio: Number(fft.peakRatio.toFixed(2)) }
        : null,
      notch,
      severity,
    };

    if (severity === "CRITICAL") report.global = "CRITICAL";
    else if (severity === "WARNING" && report.global !== "CRITICAL") report.global = "WARNING";
  }

  return report;
}

/* ================= SVG HELPERS ================= */
function buildPolyline(points, w, h, pad = 10) {
  if (!points.length) return "";
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;

  return points.map((p) => {
    const X = pad + ((p.x - minX) / dx) * (w - 2 * pad);
    const Y = h - pad - ((p.y - minY) / dy) * (h - 2 * pad);
    return `${X.toFixed(1)},${Y.toFixed(1)}`;
  }).join(" ");
}

function downsampleSeries(arr, maxPoints) {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  return out;
}

function severityColor(sev) {
  if (sev === "CRITICAL") return "var(--critical)";
  if (sev === "WARNING") return "var(--warning)";
  return "var(--ok)";
}

/* ================= APP ================= */
export default function App() {
  const [fw, setFw] = useState(localStorage.getItem(FW_KEY) || "ArduPilot");
  const [theme, setTheme] = useState(getInitialTheme());
  const [section, setSection] = useState("Overview");

  const [axis, setAxis] = useState("roll");
  const [visibleAxis, setVisibleAxis] = useState("roll");
  const [isExiting, setIsExiting] = useState(false);

  const [rawData, setRawData] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  // ✅ NEW: thresholds as state (editable)
  const [vibWarnRatio, setVibWarnRatio] = useState(DEFAULT_VIB_WARN_RATIO);
  const [vibCritRatio, setVibCritRatio] = useState(DEFAULT_VIB_CRIT_RATIO);

  useEffect(() => {
    localStorage.setItem(FW_KEY, fw);
  }, [fw]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const P = PARAMS[fw];

  const onAxisChange = (nextAxis) => {
    if (!report) return;
    if (nextAxis === axis) return;
    setIsExiting(true);
    setTimeout(() => {
      setAxis(nextAxis);
      setVisibleAxis(nextAxis);
      setIsExiting(false);
    }, 180);
  };

  const onFile = (file) => {
    setError("");
    setRawData(null);
    setReport(null);
    if (!file) return;
    parseCSV(
      file,
      (data) => {
        setRawData(data);
        setReport(buildReport(data, vibWarnRatio, vibCritRatio));
      },
      (msg) => setError(msg)
    );
  };

  // re-run analysis if thresholds change (when data is loaded)
  useEffect(() => {
    if (!rawData) return;
    setReport(buildReport(rawData, vibWarnRatio, vibCritRatio));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vibWarnRatio, vibCritRatio]);

  const chartData = useMemo(() => {
    if (!rawData) return null;
    const series = rawData.map((r) => ({ t: r.time, gyro: r[axis].gyro, set: r[axis].set }));
    return downsampleSeries(series, 260);
  }, [rawData, axis]);

  const spectrum = useMemo(() => {
    if (!rawData || !report?.axes?.[axis]?.fft) return null;
    const fsHz = report.fs;
    const gyro = rawData.map((r) => r[axis].gyro);
    const fft = computeAxisFFT(gyro, fsHz);
    return fft?.spectrum || null;
  }, [rawData, report, axis]);

  return (
    <div className="app">
      <style>{`
        :root{
          --card:#0c1324;
          --border:#1e2a4a;
          --text:#e5e7eb;
          --muted:#94a3b8;
          --accent:#38bdf8;
          --critical:#ef4444;
          --warning:#f59e0b;
          --ok:#16a34a;
        }
        [data-theme="light"]{
          --card:#ffffff;
          --border:#d8dee9;
          --text:#0f172a;
          --muted:#475569;
          --accent:#0284c7;
          --critical:#dc2626;
          --warning:#d97706;
          --ok:#16a34a;
        }
        body{
          margin:0;
          background: radial-gradient(circle at top, #0c142a, #05070f);
          color:var(--text);
          font-family: Inter, system-ui, sans-serif;
        }
        [data-theme="light"] body{
          background: linear-gradient(#f8fafc, #eef2ff);
        }
        .app{ max-width: 980px; margin: 0 auto; padding: 16px; }

        @keyframes enter { from { opacity:0; transform: translateY(10px);} to { opacity:1; transform: translateY(0);} }
        @keyframes exit { from { opacity:1; transform: translateY(0);} to { opacity:0; transform: translateY(10px);} }
        .fade-enter { animation: enter 220ms ease-out both; }
        .fade-exit  { animation: exit 180ms ease-in both; }

        header h1{ margin:0; color:var(--accent); font-size: 24px; }
        header small{ color: var(--muted); }

        .controls{ display:flex; gap:10px; flex-wrap: wrap; margin: 14px 0; align-items: center; }
        .controls input[type=file]{ background: var(--card); border:1px dashed var(--border); color: var(--muted); padding: 10px; border-radius: 10px; width: 320px; }
        select, button, input[type=number]{
          background: var(--card);
          color: var(--text);
          border: 1px solid var(--border);
          padding: 10px 12px;
          border-radius: 10px;
        }
        button{ cursor:pointer; }

        .summary{
          background: linear-gradient(135deg, var(--card), rgba(0,0,0,0));
          border:1px solid var(--border);
          border-radius: 14px;
          padding: 14px;
          display:flex;
          gap: 12px;
          align-items:center;
          margin-top: 6px;
        }
        .badge{
          width: 72px; height:72px;
          border-radius: 999px;
          border: 2px solid;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight: 700;
          letter-spacing: .5px;
        }

        .tabs{ display:flex; gap: 16px; margin-top: 16px; border-bottom: 1px solid var(--border); }
        .tabs button{ border: none; border-radius: 0; background: transparent; padding: 10px 0; color: var(--muted); }
        .tabs button.active{ color: var(--accent); border-bottom: 2px solid var(--accent); }

        .axis-tabs{ display:flex; gap: 8px; margin: 14px 0; }
        .axis-tabs button{ flex: 1; background: var(--card); }
        .axis-tabs button.active{ outline: 2px solid rgba(56,189,248,0.35); background: rgba(56,189,248,0.08); }

        .grid{ display: grid; grid-template-columns: 1fr; gap: 12px; }

        .card{
          background: var(--card);
          border:1px solid var(--border);
          border-left: 6px solid;
          border-radius: 12px;
          padding: 14px;
          box-shadow: 0 10px 24px rgba(0,0,0,0.25);
        }
        .card.CRITICAL{ border-left-color: var(--critical); }
        .card.WARNING{ border-left-color: var(--warning); }
        .card.OK{ border-left-color: var(--ok); }

        .card h3{ margin: 0 0 6px; }
        .card p{ margin: 6px 0; color: var(--muted); }

        .param{
          display:flex;
          justify-content: space-between;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 13px;
          padding: 4px 0;
          color: var(--muted);
        }

        .kpiRow{ display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
        .kpi{ background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
        [data-theme="light"] .kpi{ background: rgba(2,8,23,0.02); }
        .kpi .label{ color: var(--muted); font-size: 12px; }
        .kpi .value{ font-size: 18px; font-weight: 700; margin-top: 4px; }

        .chart{ background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 12px; padding: 10px; overflow: hidden; }
        [data-theme="light"] .chart{ background: rgba(2,8,23,0.02); }
      `}</style>

      <header>
        <h1>{fw} PID Tune Analyzer</h1>
        <small>AI‑assisted tuning diagnostics (CSV gyro/setpoint)</small>
      </header>

      <div className="controls">
        <input type="file" accept=".csv" onChange={(e) => onFile(e.target.files?.[0])} />
        <select value={fw} onChange={(e) => setFw(e.target.value)}>
          {FIRMWARES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
        </button>

        {/* ✅ NEW: Threshold controls */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>Vib warn ≥</span>
          <input
            type="number"
            step="0.1"
            min="1"
            max="20"
            value={vibWarnRatio}
            onChange={(e) => setVibWarnRatio(Number(e.target.value))}
            style={{ width: 90 }}
          />
          <span style={{ color: "var(--muted)", fontSize: 12 }}>crit ≥</span>
          <input
            type="number"
            step="0.1"
            min="1"
            max="20"
            value={vibCritRatio}
            onChange={(e) => setVibCritRatio(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </div>
      </div>

      {error && <div style={{ color: "var(--critical)" }}>{error}</div>}

      {report && (
        <>
          <div className="summary">
            <div className="badge" style={{ borderColor: severityColor(report.global), color: severityColor(report.global) }}>
              {report.global}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Tune needs attention</div>
              <div style={{ color: "var(--muted)" }}>
                Sample rate: {report.fs.toFixed(0)} Hz · Axis: {AXIS_LABEL[axis]}
              </div>
            </div>
          </div>

          <div className="tabs">
            {["Overview", "Charts", "Recommendations"].map((t) => (
              <button key={t} className={section === t ? "active" : ""} onClick={() => setSection(t)}>
                {t}
              </button>
            ))}
          </div>

          <div className="axis-tabs">
            {AXES.map((a) => (
              <button key={a} className={visibleAxis === a ? "active" : ""} onClick={() => onAxisChange(a)}>
                {AXIS_LABEL[a].toUpperCase()}
              </button>
            ))}
          </div>

          <div className={isExiting ? "fade-exit" : "fade-enter"}>
            {section === "Overview" && (
              <div className="kpiRow">
                <div className="kpi">
                  <div className="label">Axis severity</div>
                  <div className="value" style={{ color: severityColor(report.axes[axis].severity) }}>
                    {report.axes[axis].severity}
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Overshoot</div>
                  <div className="value">
                    {report.axes[axis].overshootPct == null ? "—" : `${report.axes[axis].overshootPct}%`}
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Dominant vibration (FFT)</div>
                  <div className="value">
                    {report.axes[axis].fft?.peakFreq ? `${report.axes[axis].fft.peakFreq} Hz` : "—"}
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Peak / noise ratio</div>
                  <div className="value">
                    {report.axes[axis].fft?.peakRatio ? `${report.axes[axis].fft.peakRatio}×` : "—"}
                  </div>
                </div>
              </div>
            )}

            {section === "Charts" && chartData && (
              <>
                <div className="chart">
                  <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>
                    Time domain (Gyro vs Setpoint)
                  </div>
                  <svg width="920" height="160" viewBox="0 0 920 160">
                    <polyline
                      points={buildPolyline(chartData.map((p) => ({ x: p.t, y: p.set })), 920, 160, 14)}
                      fill="none"
                      stroke="var(--warning)"
                      strokeWidth="2"
                      strokeDasharray="6 4"
                      opacity="0.9"
                    />
                    <polyline
                      points={buildPolyline(chartData.map((p) => ({ x: p.t, y: p.gyro })), 920, 160, 14)}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2"
                      opacity="0.95"
                    />
                  </svg>
                </div>

                {spectrum && (
                  <div className="chart" style={{ marginTop: 12 }}>
                    <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>
                      Frequency domain (FFT magnitude)
                    </div>
                    <svg width="920" height="180" viewBox="0 0 920 180">
                      {(() => {
                        const ds = downsampleSeries(spectrum, 240);
                        const pts = ds.map((p) => ({ x: p.f, y: p.m }));
                        const poly = buildPolyline(pts, 920, 180, 14);
                        return (
                          <polyline
                            points={poly}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth="2"
                            opacity="0.95"
                          />
                        );
                      })()}
                    </svg>
                  </div>
                )}
              </>
            )}

            {section === "Recommendations" && (
              <div className="grid">
                {report.axes[axis].inactive && (
                  <div className="card OK">
                    <h3>No control activity detected</h3>
                    <p>This axis has no meaningful setpoint changes, so PID advice is not applicable.</p>
                  </div>
                )}

                {!report.axes[axis].inactive && report.axes[axis].notch && (
                  <div className={`card ${report.axes[axis].severity === "CRITICAL" ? "CRITICAL" : "WARNING"}`}>
                    <h3>Enable Harmonic Notch Filter (FFT‑detected)</h3>
                    <p>
                      Dominant vibration at <b>{report.axes[axis].fft?.peakFreq ?? "—"} Hz</b>{" "}
                      (peak/noise {report.axes[axis].fft?.peakRatio ?? "—"}×).
                      Thresholds: warn ≥ {vibWarnRatio}×, crit ≥ {vibCritRatio}×.
                    </p>

                    <div className="param"><span>{P.notchEnable}</span><span>1</span></div>
                    <div className="param"><span>{P.notchMode}</span><span>{fw === "ArduPilot" ? "4 (FFT)" : "FFT"}</span></div>
                    <div className="param"><span>{P.notchFreq}</span><span>{report.axes[axis].notch.center} Hz</span></div>
                    <div className="param"><span>{P.notchBW}</span><span>{report.axes[axis].notch.bw} Hz</span></div>
                    <div className="param"><span>{P.notchAtt}</span><span>{report.axes[axis].notch.att} dB</span></div>
                    <div className="param"><span>{P.notchHmncs}</span><span>{report.axes[axis].notch.harmonics}</span></div>
                  </div>
                )}

                {!report.axes[axis].inactive && report.axes[axis].overshootPct != null && report.axes[axis].overshootPct > 15 && (
                  <div className="card WARNING">
                    <h3>High Overshoot</h3>
                    <p>Response is aggressive and overshoots the target. Consider reducing P slightly.</p>
                    <div className="param"><span>{P.rateP(axis)}</span><span>Reduce 5–10%</span></div>
                  </div>
                )}

                {!report.axes[axis].inactive && report.axes[axis].severity === "OK" && (
                  <div className="card OK">
                    <h3>Tune looks balanced</h3>
                    <p>No critical issues detected for this axis in the current heuristics.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
