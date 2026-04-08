import { useEffect, useMemo, useState } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];
const AXIS_LABEL = { roll: "ROLL", pitch: "PITCH", yaw: "YAW" };
const SECTIONS = ["Overview", "Charts", "Recommendations"];
const FIRMWARES = ["iNav", "ArduPilot"];

const FFT_WINDOW = 512;
const FFT_MIN_HZ = 20;
const FFT_MAX_HZ = 300;

const DEFAULT_VIB_WARN_RATIO = 2.5;
const DEFAULT_VIB_CRIT_RATIO = 5.0;

const THEME_KEY = "pid_theme";
const FW_KEY = "pid_fw";

/* Firmware parameter mapping */
const PARAMS = {
  ArduPilot: {
    notchEnable: "INS_HNTCH_ENABLE",
    notchFreq: "INS_HNTCH_FREQ",
    notchBW: "INS_HNTCH_BW",
    rateP: (a) =>
      a === "roll" ? "ATC_RAT_RLL_P" :
      a === "pitch" ? "ATC_RAT_PIT_P" :
      "ATC_RAT_YAW_P",
  },
  iNav: {
    notchEnable: "gyro_notch1_enabled",
    notchFreq: "gyro_notch1_hz",
    notchBW: "gyro_notch1_cutoff",
    rateP: (a) => `${a}_p`,
  },
};

/* ================= UTIL ================= */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

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
      const lines = String(r.result).split(/\r?\n/).filter(x => x.trim().length);
      if (!lines.length) throw new Error("Empty file");

      // detect delimiter
      const headerLine = lines[0];
      const delim = headerLine.includes(";") ? ";" : headerLine.includes("\t") ? "\t" : ",";
      const headers = headerLine.split(delim).map(h => h.trim());
      const idx = (k) => headers.indexOf(k);

      const ti = idx("time");
      if (ti < 0) throw new Error("Missing column: time");

      const need = ["gyro[0]","gyro[1]","gyro[2]","setpoint[0]","setpoint[1]","setpoint[2]"];
      for (const k of need) {
        if (idx(k) < 0) throw new Error(`Missing column: ${k}`);
      }

      const data = lines.slice(1).map(l => {
        const p = l.split(delim);
        return {
          time: Number(p[ti]),
          roll:  { gyro: Number(p[idx("gyro[0]")]), set: Number(p[idx("setpoint[0]")]) },
          pitch: { gyro: Number(p[idx("gyro[1]")]), set: Number(p[idx("setpoint[1]")]) },
          yaw:   { gyro: Number(p[idx("gyro[2]")]), set: Number(p[idx("setpoint[2]")]) },
        };
      }).filter(r => Number.isFinite(r.time));

      if (data.length < 30) throw new Error("Not enough samples in log");
      onSuccess(data);
    } catch (e) {
      onError(e.message || String(e));
    }
  };
  r.readAsText(file);
}

/* ================= SAMPLE RATE ================= */
function sampleRateHz(data) {
  const dts = [];
  for (let i = Math.max(1, data.length - 200); i < data.length; i++) {
    const dt = data[i].time - data[i - 1].time;
    if (dt > 0 && Number.isFinite(dt)) dts.push(dt);
  }
  return 1 / (median(dts) || 0.002);
}

/* ================= FFT ================= */
function hann(N) {
  return Array.from({ length: N }, (_, i) =>
    0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)))
  );
}

function fftMagReal(sig) {
  const N = sig.length;
  const re = sig.slice();
  const im = Array(N).fill(0);

  // bit reversal
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j |= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }

  // Cooley–Tukey
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k);
        const tr = c * re[i + k + len/2] - s * im[i + k + len/2];
        const ti = s * re[i + k + len/2] + c * im[i + k + len/2];
        re[i + k + len/2] = re[i + k] - tr;
        im[i + k + len/2] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
      }
    }
  }

  return Array.from({ length: N/2 }, (_, i) => Math.hypot(re[i], im[i]) / N);
}

/* ================= CHART HELPERS ================= */
function downsample(arr, maxPoints) {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  return out;
}

function buildPolyline(points, w, h, pad=14) {
  if (!points.length) return "";
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = (maxX - minX) || 1;
  const dy = (maxY - minY) || 1;

  return points.map(p => {
    const X = pad + ((p.x - minX) / dx) * (w - 2*pad);
    const Y = h - pad - ((p.y - minY) / dy) * (h - 2*pad);
    return `${X.toFixed(1)},${Y.toFixed(1)}`;
  }).join(" ");
}

/* ================= CONFIDENCE ================= */
function confidenceFromPeakRatio(peakRatio, warnR, critR) {
  if (peakRatio == null || !Number.isFinite(peakRatio)) {
    return { label: "—", pct: 0, color: "var(--muted)" };
  }
  if (peakRatio >= critR) return { label: "HIGH", pct: 100, color: "var(--critical)" };
  if (peakRatio >= warnR) {
    const pct = clamp(((peakRatio - warnR) / (critR - warnR)) * 100, 10, 95);
    return { label: "MEDIUM", pct, color: "var(--warning)" };
  }
  const pct = clamp((peakRatio / warnR) * 100, 5, 80);
  return { label: "LOW", pct, color: "var(--ok)" };
}

/* ================= TOOLTIP ================= */
function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: tip.x + 12,
        top: tip.y + 12,
        background: "rgba(15,23,42,0.95)",
        border: "1px solid rgba(148,163,184,0.35)",
        borderRadius: 10,
        padding: "8px 10px",
        color: "#e5e7eb",
        fontSize: 12,
        fontFamily: "ui-monospace, Menlo, monospace",
        pointerEvents: "none",
        zIndex: 9999,
        boxShadow: "0 12px 34px rgba(0,0,0,0.45)"
      }}
    >
      {tip.lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

/* ================= APP ================= */
export default function App() {
  // theme & firmware
  const [theme, setTheme] = useState(getInitialTheme());
  const [fw, setFw] = useState(localStorage.getItem(FW_KEY) || "iNav");

  // navigation
  const [section, setSection] = useState("Charts");

  // axis switching w/ exit animations
  const [axis, setAxis] = useState("roll");
  const [visibleAxis, setVisibleAxis] = useState("roll");
  const [isExiting, setIsExiting] = useState(false);

  // data
  const [raw, setRaw] = useState(null);
  const [fs, setFs] = useState(null);
  const [filename, setFilename] = useState("");

  // thresholds + reset
  const [warnR, setWarnR] = useState(DEFAULT_VIB_WARN_RATIO);
  const [critR, setCritR] = useState(DEFAULT_VIB_CRIT_RATIO);

  // ui
  const [err, setErr] = useState("");
  const [tooltip, setTooltip] = useState(null);

  const P = PARAMS[fw];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(FW_KEY, fw);
  }, [fw]);

  const resetThresholds = () => {
    setWarnR(DEFAULT_VIB_WARN_RATIO);
    setCritR(DEFAULT_VIB_CRIT_RATIO);
  };

  const onAxisChange = (next) => {
    if (next === axis) return;
    setIsExiting(true);
    setTimeout(() => {
      setAxis(next);
      setVisibleAxis(next);
      setIsExiting(false);
    }, 180);
  };

  const onFile = (file) => {
    setErr("");
    setRaw(null);
    setFs(null);
    setFilename(file?.name || "");
    if (!file) return;

    parseCSV(
      file,
      (data) => {
        setRaw(data);
        setFs(sampleRateHz(data));
      },
      (msg) => setErr(msg)
    );
  };

  /* ===== Time-domain chart data ===== */
  const chartData = useMemo(() => {
    if (!raw) return null;
    const series = raw.map(r => ({ t: r.time, gyro: r[axis].gyro, set: r[axis].set }));
    return downsample(series, 260);
  }, [raw, axis]);

  /* ===== FFT spectrum + summary ===== */
  const spectrum = useMemo(() => {
    if (!raw || !fs) return null;
    const g = raw.map(r => r[axis].gyro);
    if (g.length < FFT_WINDOW) return null;

    const w = hann(FFT_WINDOW);
    const win = g.slice(-FFT_WINDOW).map((v,i)=>v*w[i]);
    const mags = fftMagReal(win);

    return mags
      .map((m,i)=>({ f: (i*fs)/FFT_WINDOW, m }))
      .filter(p => p.f >= FFT_MIN_HZ && p.f <= FFT_MAX_HZ);
  }, [raw, fs, axis]);

  const fftSummary = useMemo(() => {
    if (!spectrum || spectrum.length < 10) return null;
    let peak = spectrum[0];
    for (const p of spectrum) if (p.m > peak.m) peak = p;
    const noise = median(spectrum.map(p => p.m));
    const peakRatio = noise > 0 ? peak.m / noise : null;
    const notchCenter = peak ? Math.round(peak.f) : null;
    const notchBW = notchCenter ? Math.round(clamp(notchCenter * 0.5, 30, 140)) : null;
    return {
      peakFreq: peak.f,
      peakMag: peak.m,
      noise,
      peakRatio,
      notchCenter,
      notchBW
    };
  }, [spectrum]);

  const confidence = useMemo(() => {
    return confidenceFromPeakRatio(fftSummary?.peakRatio ?? null, warnR, critR);
  }, [fftSummary, warnR, critR]);

  // global severity (simple: vibration ratio dominates)
  const globalSeverity = useMemo(() => {
    const pr = fftSummary?.peakRatio;
    if (pr == null) return "OK";
    if (pr >= critR) return "CRITICAL";
    if (pr >= warnR) return "WARNING";
    return "OK";
  }, [fftSummary, warnR, critR]);

  const severityColor = (sev) =>
    sev === "CRITICAL" ? "var(--critical)" : sev === "WARNING" ? "var(--warning)" : "var(--ok)";

  return (
    <div className="appShell">
      <style>{`
        :root{
          --bg0:#070b14;
          --bg1:#05070f;
          --panel:#0c1324;
          --panel2:#0a1020;
          --border:#1e2a4a;
          --text:#e5e7eb;
          --muted:#94a3b8;
          --accent:#38bdf8;
          --critical:#ef4444;
          --warning:#f59e0b;
          --ok:#22c55e;
        }
        [data-theme="light"]{
          --bg0:#f8fafc;
          --bg1:#eef2ff;
          --panel:#ffffff;
          --panel2:#f8fafc;
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
          background: radial-gradient(circle at top, #0c142a, var(--bg1));
          color:var(--text);
          font-family: Inter, system-ui, sans-serif;
        }
        .appShell{
          max-width: 980px;
          margin: 0 auto;
          padding: 18px 16px 28px;
        }
        .title{
          font-size: 20px;
          font-weight: 800;
          color: var(--accent);
          margin: 4px 0 2px;
        }
        .subtitle{
          margin: 0 0 14px;
          color: var(--muted);
          font-size: 12px;
        }

        /* Controls row (like screenshot) */
        .controlsRow{
          display:flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          padding: 10px;
          background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.00));
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        .fileBox{
          display:flex;
          align-items:center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--panel2);
          min-width: 320px;
        }
        .fileName{
          color: var(--muted);
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 180px;
        }
        input[type=file]{
          color: var(--muted);
          font-size: 12px;
        }
        select, button, input[type=number]{
          background: var(--panel2);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 12px;
        }
        button{
          cursor:pointer;
        }
        .pillBtn{
          display:flex;
          align-items:center;
          gap: 8px;
          padding: 8px 12px;
        }

        .tinyLabel{
          color: var(--muted);
          font-size: 12px;
        }
        .numInput{
          width: 70px;
          text-align: center;
          font-weight: 700;
        }

        /* Summary card */
        .summary{
          margin-top: 12px;
          background: linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.00));
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 14px;
          display:flex;
          gap: 14px;
          align-items:center;
        }
        .sevCircle{
          width: 64px;
          height: 64px;
          border-radius: 999px;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight: 900;
          font-size: 11px;
          letter-spacing: .6px;
          border: 2px solid;
        }
        .summaryTitle{
          font-weight: 900;
          font-size: 16px;
          margin: 0;
        }
        .summaryMeta{
          margin-top: 2px;
          color: var(--muted);
          font-size: 12px;
        }

        /* Confidence bar */
        .confWrap{
          margin-left:auto;
          min-width: 260px;
        }
        .confTop{
          display:flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 10px;
          color: var(--muted);
          font-size: 12px;
        }
        .confBar{
          margin-top: 6px;
          height: 10px;
          border-radius: 999px;
          background: rgba(148,163,184,0.22);
          overflow:hidden;
        }
        .confFill{
          height: 100%;
          transition: width 200ms ease;
        }

        /* Tabs */
        .tabs{
          display:flex;
          gap: 18px;
          margin-top: 14px;
          border-bottom: 1px solid var(--border);
        }
        .tabBtn{
          background: transparent;
          border: none;
          color: var(--muted);
          padding: 10px 0;
          border-radius: 0;
          font-size: 12px;
        }
        .tabBtn.active{
          color: var(--accent);
          border-bottom: 2px solid var(--accent);
        }

        /* Axis pills */
        .axisRow{
          display:flex;
          gap: 10px;
          margin-top: 12px;
        }
        .axisBtn{
          flex: 1;
          padding: 10px 0;
          background: var(--panel2);
          border: 1px solid var(--border);
          border-radius: 10px;
          font-weight: 800;
          letter-spacing: .3px;
          transition: transform 120ms ease, background 120ms ease;
        }
        .axisBtn:hover{ transform: translateY(-1px); }
        .axisBtn.active{
          background: rgba(56,189,248,0.10);
          outline: 2px solid rgba(56,189,248,0.25);
        }

        /* Chart panel */
        .panel{
          margin-top: 12px;
          background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.00));
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 12px;
        }
        .panelTitle{
          color: var(--muted);
          font-size: 12px;
          margin-bottom: 8px;
        }
        svg.chart{
          width: 100%;
          height: 220px;
          display:block;
          border-radius: 12px;
          background: radial-gradient(circle at top, rgba(56,189,248,0.06), rgba(0,0,0,0));
        }
        .fftPanel{
          margin-top: 12px;
        }

        /* Exit/enter */
        @keyframes enter {
          from { opacity:0; transform: translateY(10px); }
          to { opacity:1; transform: translateY(0); }
        }
        @keyframes exit {
          from { opacity:1; transform: translateY(0); }
          to { opacity:0; transform: translateY(10px); }
        }
        .fadeEnter{ animation: enter 220ms ease-out both; }
        .fadeExit{ animation: exit 180ms ease-in both; }

        .error{
          margin-top: 10px;
          color: var(--critical);
          font-weight: 700;
        }
      `}</style>

      <div className="title">{fw} PID Tune Analyzer</div>
      <div className="subtitle">AI-assisted tuning diagnostics (CSV gyro/setpoint)</div>

      {/* Controls (like screenshot) */}
      <div className="controlsRow">
        <div className="fileBox">
          <input type="file" accept=".csv" onChange={(e) => onFile(e.target.files?.[0])} />
          <div className="fileName">{filename || "No file selected"}</div>
        </div>

        <select value={fw} onChange={(e) => setFw(e.target.value)}>
          {FIRMWARES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <button className="pillBtn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <span>{theme === "dark" ? "☀️" : "🌙"}</span>
          <span>{theme === "dark" ? "Light" : "Dark"}</span>
        </button>

        <span className="tinyLabel">Vib warn ≥</span>
        <input className="numInput" type="number" step="0.1" min="1" max="20" value={warnR}
          onChange={(e) => setWarnR(Number(e.target.value))} />

        <span className="tinyLabel">crit ≥</span>
        <input className="numInput" type="number" step="0.1" min="1" max="20" value={critR}
          onChange={(e) => setCritR(Number(e.target.value))} />

        <button onClick={resetThresholds}>Reset thresholds</button>
      </div>

      {err && <div className="error">{err}</div>}

      {/* Summary */}
      {raw && fs && (
        <>
          <div className="summary">
            <div className="sevCircle" style={{ borderColor: severityColor(globalSeverity), color: severityColor(globalSeverity) }}>
              {globalSeverity}
            </div>

            <div>
              <div className="summaryTitle">Tune needs attention</div>
              <div className="summaryMeta">
                Sample rate: {fs.toFixed(0)} Hz · Axis: {AXIS_LABEL[axis].replaceAll("_"," ")}
              </div>
            </div>

            {/* Confidence meter */}
            <div className="confWrap">
              <div className="confTop">
                <span>FFT confidence: <b style={{ color: confidence.color }}>{confidence.label}</b></span>
                <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
                  peakRatio: {fftSummary?.peakRatio ? fftSummary.peakRatio.toFixed(2) + "×" : "—"}
                </span>
              </div>
              <div className="confBar">
                <div className="confFill" style={{ width: `${confidence.pct}%`, background: confidence.color }} />
              </div>
              <div className="confTop" style={{ marginTop: 6 }}>
                <span>LOW &lt; {warnR}×</span>
                <span>HIGH ≥ {critR}×</span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="tabs">
            {SECTIONS.map(s => (
              <button
                key={s}
                className={`tabBtn ${section === s ? "active" : ""}`}
                onClick={() => setSection(s)}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Axis pills */}
          <div className="axisRow">
            {AXES.map(a => (
              <button
                key={a}
                className={`axisBtn ${visibleAxis === a ? "active" : ""}`}
                onClick={() => onAxisChange(a)}
              >
                {AXIS_LABEL[a]}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className={isExiting ? "fadeExit" : "fadeEnter"}>
            {/* OVERVIEW */}
            {section === "Overview" && (
              <div className="panel">
                <div className="panelTitle">Key FFT values (computed from log)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 12, background: "var(--panel2)" }}>
                    <div className="tinyLabel">Peak frequency</div>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>
                      {fftSummary?.peakFreq ? `${fftSummary.peakFreq.toFixed(1)} Hz` : "—"}
                    </div>
                  </div>
                  <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 12, background: "var(--panel2)" }}>
                    <div className="tinyLabel">Suggested notch</div>
                    <div style={{ fontSize: 14, fontWeight: 900, fontFamily: "ui-monospace, Menlo, monospace" }}>
                      {fftSummary?.notchCenter ? `${P.notchFreq}=${fftSummary.notchCenter}, ${P.notchBW}=${fftSummary.notchBW}` : "—"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* CHARTS */}
            {section === "Charts" && chartData && (
              <>
                <div className="panel">
                  <div className="panelTitle">Time domain (Gyro vs Setpoint)</div>
                  <svg
                    className="chart"
                    viewBox="0 0 1000 240"
                    onMouseLeave={() => setTooltip(null)}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
                      const idx = Math.round(ratio * (chartData.length - 1));
                      const p = chartData[idx];
                      if (!p) return;
                      setTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        lines: [
                          `Time: ${p.t.toFixed(3)} s`,
                          `Gyro: ${p.gyro.toFixed(2)}`,
                          `Set:  ${p.set.toFixed(2)}`
                        ]
                      });
                    }}
                  >
                    {/* setpoint dashed */}
                    <polyline
                      points={buildPolyline(chartData.map(p => ({ x: p.t, y: p.set })), 1000, 240, 18)}
                      fill="none"
                      stroke="var(--warning)"
                      strokeWidth="2.5"
                      strokeDasharray="7 5"
                      opacity="0.95"
                    />
                    {/* gyro */}
                    <polyline
                      points={buildPolyline(chartData.map(p => ({ x: p.t, y: p.gyro })), 1000, 240, 18)}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="3"
                      opacity="0.95"
                    />
                  </svg>
                </div>

                {spectrum && (
                  <div className="panel fftPanel">
                    <div className="panelTitle">Frequency domain (FFT magnitude)</div>
                    <svg
                      className="chart"
                      viewBox="0 0 1000 240"
                      onMouseLeave={() => setTooltip(null)}
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
                        const idx = Math.round(ratio * (spectrum.length - 1));
                        const p = spectrum[idx];
                        if (!p) return;
                        setTooltip({
                          x: e.clientX,
                          y: e.clientY,
                          lines: [
                            `Freq: ${p.f.toFixed(1)} Hz`,
                            `Mag:  ${p.m.toExponential(2)}`
                          ]
                        });
                      }}
                    >
                      <polyline
                        points={buildPolyline(
                          downsample(spectrum, 260).map(p => ({ x: p.f, y: p.m })),
                          1000, 240, 18
                        )}
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="3"
                        opacity="0.95"
                      />
                    </svg>
                  </div>
                )}
              </>
            )}

            {/* RECOMMENDATIONS */}
            {section === "Recommendations" && (
              <div className="panel">
                <div className="panelTitle">Recommended changes (FFT-based)</div>

                {fftSummary?.notchCenter ? (
                  <div style={{
                    marginTop: 4,
                    background: "var(--panel2)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 12
                  }}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>
                      {globalSeverity === "CRITICAL" ? "CRITICAL" : "WARNING"} — Enable Notch Filter
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
                      Dominant vibration detected around <b>{fftSummary.peakFreq.toFixed(1)} Hz</b> (peakRatio{" "}
                      <b>{fftSummary.peakRatio ? fftSummary.peakRatio.toFixed(2) : "—"}×</b>).
                    </div>

                    <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, color: "var(--muted)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                        <span>{P.notchEnable}</span><span>1</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                        <span>{P.notchFreq}</span><span>{fftSummary.notchCenter} Hz</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                        <span>{P.notchBW}</span><span>{fftSummary.notchBW} Hz</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                        <span>{P.rateP(axis)}</span><span>Reduce 5–10% (if overshoot)</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: "var(--muted)", marginTop: 6 }}>
                    FFT peak not available (need ≥ {FFT_WINDOW} samples). Load a longer log or higher sample rate.
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <Tooltip tip={tooltip} />
    </div>
  );
}
