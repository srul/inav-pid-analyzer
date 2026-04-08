import { useState, useEffect } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];
const SEVERITY_ORDER = { OK: 0, WARNING: 1, CRITICAL: 2 };
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

/* ================= URL (Shareable Reports) ================= */
function encodeReport(report) {
  return btoa(encodeURIComponent(JSON.stringify(report)));
}
function decodeReport(hash) {
  try {
    return JSON.parse(decodeURIComponent(atob(hash)));
  } catch {
    return null;
  }
}

/* ================= CSV PARSER ================= */
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
      axes[a] = { severity: "OK", note: "Inactive" };
      return;
    }

    const peak = Math.max(...g);
    const overshoot = ((peak - fs) / Math.abs(fs)) * 100;

    let severity = "OK";
    if (overshoot > 15) severity = "WARNING";
    if (overshoot > 30) severity = "CRITICAL";

    if (SEVERITY_ORDER[severity] > SEVERITY_ORDER[global])
      global = severity;

    axes[a] = {
      severity,
      overshoot: overshoot.toFixed(1),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    global,
    axes,
  };
}

/* ================= APP ================= */
export default function App() {
  const [report, setReport] = useState(null);
  const [presets, setPresets] = useState(loadPresets());
  const [presetName, setPresetName] = useState("");
  const [theme, setTheme] = useState(getInitialTheme());
  const [printMode, setPrintMode] = useState(false);
  const [error, setError] = useState("");

  /* Apply theme */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  /* Restore from URL */
  useEffect(() => {
    if (window.location.hash.length > 1) {
      const r = decodeReport(window.location.hash.slice(1));
      if (r) setReport(r);
    }
  }, []);

  /* Update URL on change */
  useEffect(() => {
    if (report) {
      window.location.hash = encodeReport(report);
    }
  }, [report]);

  function savePreset() {
    if (!presetName || !report) return;
    const next = [...presets, { id: Date.now(), name: presetName, report }];
    setPresets(next);
    savePresets(next);
    setPresetName("");
  }

  function loadPreset(p) {
    setReport(p.report);
  }

  function deletePreset(id) {
    const next = presets.filter(p => p.id !== id);
    setPresets(next);
    savePresets(next);
  }

  function enterPrint() {
    setPrintMode(true);
    document.documentElement.setAttribute("data-theme", "light");
    setTimeout(() => window.print(), 50);
  }

  function exitPrint() {
    setPrintMode(false);
    document.documentElement.setAttribute("data-theme", theme);
  }

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: "auto" }}>
      <style>{`
        :root {
          --bg: #ffffff;
          --fg: #111827;
          --card: #f3f4f6;
          --border: #d1d5db;
        }
        [data-theme="dark"] {
          --bg: #020617;
          --fg: #e5e7eb;
          --card: #020617;
          --border: #334155;
        }
        body {
          background: var(--bg);
          color: var(--fg);
        }
        table {
          border-collapse: collapse;
          width: 100%;
        }
        th, td {
          border: 1px solid var(--border);
          padding: 6px;
        }
        @media print {
          button, input { display: none !important; }
        }
      `}</style>

      <h1>PID Analyzer (Final)</h1>

      {!printMode && (
        <>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode"}
          </button>

          <br /><br />

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
        </>
      )}

      {error && <div style={{ color: "red" }}>{error}</div>}

      {report && (
        <>
          <p><b>Generated:</b> {new Date(report.generatedAt).toLocaleString()}</p>

          <h2>
            Global Status:{" "}
            <span style={{
              color:
                report.global === "CRITICAL"
                  ? "red"
                  : report.global === "WARNING"
                  ? "orange"
                  : "green"
            }}>
              {report.global}
            </span>
          </h2>

          <table>
            <thead>
              <tr>
                <th>Axis</th>
                <th>Severity</th>
                <th>Overshoot (%)</th>
              </tr>
            </thead>
            <tbody>
              {AXES.map(a => (
                <tr key={a}>
                  <td>{a}</td>
                  <td>{report.axes[a].severity}</td>
                  <td>{report.axes[a].overshoot ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!printMode && (
            <>
              <br />
              <input
                placeholder="Preset name"
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
              />
              <button onClick={savePreset}>Save Preset</button>
              <button onClick={enterPrint} style={{ marginLeft: 8 }}>
                Print / Save PDF
              </button>

              {presets.length > 0 && (
                <>
                  <h3>Saved Presets</h3>
                  <ul>
                    {presets.map(p => (
                      <li key={p.id}>
                        <b>{p.name}</b>{" "}
                        <button onClick={() => loadPreset(p)}>Load</button>
                        <button onClick={() => deletePreset(p.id)}>Delete</button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p>
                🔗 This report is encoded in the URL — copy the link to share it.
              </p>
            </>
          )}
        </>
      )}

      {printMode && (
        <button onClick={exitPrint}>Exit Print Mode</button>
      )}
    </div>
  );
}
``
