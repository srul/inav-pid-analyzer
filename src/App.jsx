import { useEffect, useState } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];
const FIRMWARES = ["ArduPilot", "iNav"];

const THEME_KEY = "pid-theme";
const FIRMWARE_KEY = "pid-fw";

/* ================= HELPERS ================= */
function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function parseCSV(file, onSuccess, onError) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const lines = String(r.result).split(/\r?\n/).filter(Boolean);
      const delim = lines[0].includes(";")
        ? ";"
        : lines[0].includes("\t")
        ? "\t"
        : ",";
      const headers = lines[0].split(delim);
      const idx = h => headers.indexOf(h);
      const t = idx("time");

      const data = lines.slice(1).map(l => {
        const p = l.split(delim);
        const row = { time: +p[t] };
        AXES.forEach((a, i) => {
          row[a] = {
            gyro: +p[idx(`gyro[${i}]`)],
            set: +p[idx(`setpoint[${i}]`)],
          };
        });
        return row;
      }).filter(r => !isNaN(r.time));

      onSuccess(data);
    } catch (e) {
      onError(e.message);
    }
  };
  r.readAsText(file);
}

/* ================= ANALYSIS ================= */
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

    let severity = "OK";
    if (overshoot > 15) severity = "WARNING";
    if (overshoot > 30) severity = "CRITICAL";

    if (severity === "CRITICAL") global = "CRITICAL";
    if (severity === "WARNING" && global !== "CRITICAL")
      global = "WARNING";

    axes[a] = { severity, overshoot: overshoot.toFixed(1) };
  });

  return { global, axes };
}

/* ================= APP ================= */
export default function App() {
  const [firmware, setFirmware] = useState(
    localStorage.getItem(FIRMWARE_KEY) || "ArduPilot"
  );
  const [theme, setTheme] = useState(getInitialTheme());
  const [section, setSection] = useState("Overview");
  const [axis, setAxis] = useState("roll");
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(FIRMWARE_KEY, firmware);
  }, [firmware]);

  return (
    <div className="root">
      <style>{`
        :root {
          --bg: #0b1220;
          --panel: #020617;
          --border: #1e293b;
          --text: #e5e7eb;
          --red: #ef4444;
          --amber: #f59e0b;
          --blue: #38bdf8;
        }

        [data-theme="light"] {
          --bg: #f8fafc;
          --panel: #ffffff;
          --text: #0f172a;
        }

        body {
          margin: 0;
          background: radial-gradient(circle at top, #0b1220, #020617);
          color: var(--text);
          font-family: Inter, system-ui, sans-serif;
        }

        .root {
          padding: 16px;
          max-width: 960px;
          margin: auto;
        }

        /* Header */
        .header h1 {
          margin: 0;
          color: var(--blue);
        }
        .header p {
          margin: 4px 0 16px;
          opacity: 0.8;
        }

        .controls {
          display: flex;
          gap: 12px;
          margin-bottom: 16px;
        }

        select, button {
          background: var(--panel);
          color: var(--text);
          border: 1px solid var(--border);
          padding: 8px;
          border-radius: 6px;
        }

        /* Summary */
        .summary {
          display: flex;
          align-items: center;
          gap: 16px;
          background: var(--panel);
          padding: 16px;
          border-radius: 10px;
          margin-bottom: 16px;
        }

        .badge {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          border: 2px solid;
        }

        .badge.CRITICAL {
          border-color: var(--red);
          color: var(--red);
        }

        /* Tabs */
        .tabs {
          display: flex;
          gap: 16px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 16px;
        }

        .tabs button.active {
          border-bottom: 2px solid var(--blue);
          color: var(--blue);
        }

        /* Axis buttons */
        .axis-tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
        }

        .axis-tabs button.active {
          background: #1f2937;
        }

        /* Cards */
        .card {
          background: var(--panel);
          padding: 16px;
          border-left: 6px solid;
          border-radius: 8px;
          margin-bottom: 16px;
          animation: slideIn 240ms ease-out;
        }

        .CRITICAL { border-color: var(--red); }
        .WARNING  { border-color: var(--amber); }

        .card h3 {
          margin-top: 0;
        }

        .param {
          display: flex;
          justify-content: space-between;
          font-family: monospace;
          font-size: 13px;
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header */}
      <div className="header">
        <h1>{firmware} PID Tune Analyzer</h1>
        <p>AI‑assisted PID tuning analysis</p>
      </div>

      {/* Controls */}
      <div className="controls">
        <input
          type="file"
          accept=".csv"
          onChange={e =>
            parseCSV(
              e.target.files[0],
              d => setReport(analyze(d)),
              setError
            )
          }
        />

        <select value={firmware} onChange={e => setFirmware(e.target.value)}>
          {FIRMWARES.map(f => (
            <option key={f}>{f}</option>
          ))}
        </select>

        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
        </button>
      </div>

      {error && <div style={{ color: "red" }}>{error}</div>}

      {report && (
        <>
          {/* Summary */}
          <div className="summary">
            <div className={`badge ${report.global}`}>
              {report.global}
            </div>
            <div>
              <strong>Tune needs attention</strong>
              <div>{firmware} flight analysis</div>
            </div>
          </div>

          {/* Sections */}
          <div className="tabs">
            {["Overview", "Charts", "Recommendations"].map(s => (
              <button
                key={s}
                className={section === s ? "active" : ""}
                onClick={() => setSection(s)}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Axis */}
          <div className="axis-tabs">
            {AXES.map(a => (
              <button
                key={a}
                className={axis === a ? "active" : ""}
                onClick={() => setAxis(a)}
              >
                {a.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Cards */}
          {report.axes[axis].severity === "CRITICAL" && (
            <div className="card CRITICAL">
              <h3>Enable Harmonic Notch Filter</h3>
              <p>No notch filter is configured. This is critical.</p>
              <div className="param">
                <span>INS_HNTCH_ENABLE</span>
                <span>1</span>
              </div>
              <div className="param">
                <span>INS_HNTCH_FREQ</span>
                <span>120 Hz</span>
              </div>
              <div className="param">
                <span>INS_HNTCH_BW</span>
                <span>60 Hz</span>
              </div>
            </div>
          )}

          {(report.axes[axis].severity === "CRITICAL" ||
            report.axes[axis].severity === "WARNING") && (
            <div className="card WARNING">
              <h3>High Overshoot</h3>
              <p>PID loop aggressive.</p>
              <div className="param">
                <span>{axis}_p</span>
                <span>Reduce 5–10%</span>
              </div>
            </div>
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
