import { useEffect, useState } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];
const PRESET_KEY = "pid-analyzer-presets";
const THEME_KEY = "pid-analyzer-theme";

/* ================= THEME ================= */
function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/* ================= STORAGE ================= */
function loadPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESET_KEY)) || [];
  } catch {
    return [];
  }
}
function savePresets(presets) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
}

/* ================= CSV ================= */
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
  let global = "OK";
  const axes = {};

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
    else if (severity === "WARNING" && global !== "CRITICAL")
      global = "WARNING";

    axes[a] = { severity, overshoot: overshoot.toFixed(1) };
  });

  return {
    generatedAt: new Date().toISOString(),
    global,
    axes,
  };
}

/* ================= APP ================= */
export default function App() {
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [axis, setAxis] = useState("roll");
  const [view, setView] = useState("analyzer"); // ✅ Option A
  const [theme, setTheme] = useState(getInitialTheme());
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return (
    <div className={`app ${view}`}>
      <style>{`
        body {
          margin: 0;
          font-family: Inter, system-ui, sans-serif;
        }

        .app.analyzer {
          min-height: 100vh;
          background: radial-gradient(circle at top, #0b1220, #020617);
          color: #e5e7eb;
          padding: 24px;
        }

        .top-bar {
          font-size: 28px;
          font-weight: 600;
          color: #ef4444;
          border-bottom: 2px solid #ef4444;
          margin-bottom: 16px;
        }

        .axis-tabs {
          display: flex;
          gap: 8px;
          margin: 16px 0;
        }

        .axis-tabs button {
          flex: 1;
          padding: 10px;
          background: #020617;
          border: 1px solid #334155;
          color: #e5e7eb;
          border-radius: 6px;
        }

        .axis-tabs button.active {
          background: #334155;
        }

        .card {
          background: #020617;
          border-left: 6px solid;
          padding: 16px;
          margin-bottom: 16px;
          border-radius: 6px;
        }

        .card.CRITICAL { border-color: #ef4444; }
        .card.WARNING  { border-color: #f59e0b; }

        .card-title {
          font-weight: 600;
          margin-bottom: 6px;
        }

        .param {
          display: flex;
          justify-content: space-between;
          font-family: monospace;
          font-size: 13px;
          opacity: 0.9;
        }
      `}</style>

      {/* VIEW TOGGLE */}
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setView("analyzer")}>Analyzer View</button>
        <button onClick={() => setView("report")} style={{ marginLeft: 8 }}>
          Report View
        </button>
      </div>

      {view === "analyzer" && (
        <>
          <div className="top-bar">Tune Needs Attention</div>

          <input
            type="file"
            accept=".csv"
            onChange={e =>
              parseCSV(
                e.target.files[0],
                d => {
                  setData(d);
                  setReport(analyze(d));
                },
                setError
              )
            }
          />

          {error && <div style={{ color: "red" }}>{error}</div>}

          {report && (
            <>
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

              {report.axes[axis].severity === "CRITICAL" && (
                <div className="card CRITICAL">
                  <div className="card-title">CRITICAL</div>
                  Enable Harmonic Notch Filter
                  <div className="param">
                    <span>gyro_notch1_hz</span>
                    <span>120 Hz</span>
                  </div>
                  <div className="param">
                    <span>gyro_notch1_cutoff</span>
                    <span>60 Hz</span>
                  </div>
                </div>
              )}

              {report.axes[axis].severity !== "OK" && (
                <div className="card WARNING">
                  <div className="card-title">WARNING</div>
                  High Overshoot
                  <div className="param">
                    <span>{axis}_p</span>
                    <span>Reduce 5–10%</span>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {view === "report" && (
        <div style={{ padding: 24 }}>
          <h2>Report View</h2>
          {report && <pre>{JSON.stringify(report, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}
