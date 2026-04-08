import { useEffect, useState } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];
const FIRMWARES = ["ArduPilot", "iNav"];

const PARAMS = {
  ArduPilot: {
    notchEnable: "INS_HNTCH_ENABLE",
    notchFreq: "INS_HNTCH_FREQ",
    notchBW: "INS_HNTCH_BW",
    rateP: a => `ATC_RAT_${a.toUpperCase()}_P`
  },
  iNav: {
    notchEnable: "gyro_notch1_enabled",
    notchFreq: "gyro_notch1_hz",
    notchBW: "gyro_notch1_cutoff",
    rateP: a => `${a}_p`
  }
};

const THEME_KEY = "pid-theme";
const FW_KEY = "pid-fw";

/* ================= HELPERS ================= */
function parseCSV(file, ok, err) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const lines = String(r.result).split(/\r?\n/).filter(Boolean);
      const h = lines[0].split(",");
      const idx = k => h.indexOf(k);
      const t = idx("time");

      const data = lines.slice(1).map(l => {
        const p = l.split(",");
        const row = { time: +p[t] };
        AXES.forEach((a, i) => {
          row[a] = { gyro: +p[idx(`gyro[${i}]`)], set: +p[idx(`setpoint[${i}]`)] };
        });
        return row;
      });
      ok(data);
    } catch (e) {
      err(e.message);
    }
  };
  r.readAsText(file);
}

function analyze(data) {
  const axes = {};
  let global = "OK";

  AXES.forEach(a => {
    const g = data.map(r => r[a].gyro);
    const s = data.map(r => r[a].set);
    const fs = s.at(-1);

    if (Math.abs(fs) < 1e-6) {
      axes[a] = { severity: "OK" };
      return;
    }

    const peak = Math.max(...g);
    const overshoot = ((peak - fs) / Math.abs(fs)) * 100;

    let sev = "OK";
    if (overshoot > 15) sev = "WARNING";
    if (overshoot > 30) sev = "CRITICAL";

    if (sev === "CRITICAL") global = "CRITICAL";
    else if (sev === "WARNING" && global !== "CRITICAL") global = "WARNING";

    axes[a] = { severity: sev, overshoot: overshoot.toFixed(1) };
  });

  return { global, axes, data };
}

/* ================= APP ================= */
export default function App() {
  const [fw, setFw] = useState(localStorage.getItem(FW_KEY) || "ArduPilot");
  const [theme, setTheme] = useState(localStorage.getItem(THEME_KEY) || "dark");
  const [axis, setAxis] = useState("roll");
  const [section, setSection] = useState("Overview");
  const [report, setReport] = useState(null);

  useEffect(() => {
    localStorage.setItem(FW_KEY, fw);
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [fw, theme]);

  const P = PARAMS[fw];

  return (
    <div className="app">
      <style>{`
        :root {
          --bg: #070b14;
          --card: #0c1324;
          --border: #1e2a4a;
          --text: #e5e7eb;
          --muted: #94a3b8;
          --accent: #38bdf8;
          --critical: #ef4444;
          --warning: #f59e0b;
        }

        body {
          margin: 0;
          background: radial-gradient(circle at top, #0c142a, #05070f);
          color: var(--text);
          font-family: Inter, system-ui;
        }

        .app {
          max-width: 960px;
          margin: auto;
          padding: 16px;
        }

        header h1 {
          margin: 0;
          color: var(--accent);
        }

        header small {
          color: var(--muted);
        }

        .controls {
          display: flex;
          gap: 8px;
          margin: 16px 0;
        }

        select, button, input {
          background: var(--card);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px;
        }

        .tabs {
          display: flex;
          gap: 16px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 12px;
        }

        .tabs button.active {
          color: var(--accent);
          border-bottom: 2px solid var(--accent);
        }

        .summary {
          background: linear-gradient(135deg, #0b1220, #060a14);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          gap: 16px;
          align-items: center;
        }

        .badge {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          border: 2px solid;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
        }

        .axis-tabs {
          display: flex;
          gap: 6px;
          margin: 16px 0;
        }

        .axis-tabs button.active {
          background: #1e293b;
        }

        .card {
          background: var(--card);
          border-left: 5px solid;
          border-radius: 10px;
          padding: 16px;
          margin-bottom: 14px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        }

        .CRITICAL { border-color: var(--critical); }
        .WARNING  { border-color: var(--warning); }

        .param {
          display: flex;
          justify-content: space-between;
          font-family: monospace;
          font-size: 13px;
          color: var(--muted);
        }

        svg {
          width: 100%;
          height: 120px;
          background: #05070f;
          border-radius: 8px;
        }
      `}</style>

      <header>
        <h1>{fw} PID Tune Analyzer</h1>
        <small>AI-assisted tuning diagnostics</small>
      </header>

      <div className="controls">
        <input type="file" onChange={e => parseCSV(e.target.files[0], d => setReport(analyze(d)), alert)} />
        <select value={fw} onChange={e => setFw(e.target.value)}>
          {FIRMWARES.map(f => <option key={f}>{f}</option>)}
        </select>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>

      {report && (
        <>
          <div className="summary">
            <div className={`badge ${report.global}`}>{report.global}</div>
            <div>
              <strong>Tune needs attention</strong>
              <div>{fw} flight log</div>
            </div>
          </div>

          <div className="tabs">
            {["Overview", "Charts", "Recommendations"].map(t =>
              <button key={t} className={section === t ? "active" : ""} onClick={() => setSection(t)}>
                {t}
              </button>
            )}
          </div>

          <div className="axis-tabs">
            {AXES.map(a =>
              <button key={a} className={axis === a ? "active" : ""} onClick={() => setAxis(a)}>
                {a.toUpperCase()}
              </button>
            )}
          </div>

          {section === "Charts" && (
            <svg>
              <polyline
                points={report.data.map((r,i) => `${i*3},${120 - r[axis].gyro}`).join(" ")}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2"
              />
            </svg>
          )}

          {section !== "Charts" && report.axes[axis].severity !== "OK" && (
            <>
              {report.axes[axis].severity === "CRITICAL" && (
                <div className="card CRITICAL">
                  <h3>Enable Harmonic Notch Filter</h3>
                  <div className="param"><span>{P.notchEnable}</span><span>1</span></div>
                  <div className="param"><span>{P.notchFreq}</span><span>120 Hz</span></div>
                  <div className="param"><span>{P.notchBW}</span><span>60 Hz</span></div>
                </div>
              )}

              <div className="card WARNING">
                <h3>High Overshoot</h3>
                <div className="param"><span>{P.rateP(axis)}</span><span>Reduce 5–10%</span></div>
              </div>
            </>
          )}

          {report.axes[axis].severity === "OK" && (
            <div className="card">
              <h3>No issues detected</h3>
            </div>
          )}
        </>
      )}
    </div>
  );
}
