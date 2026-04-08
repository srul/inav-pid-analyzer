import { useState, useEffect } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];
const SEVERITY_ORDER = { OK: 0, WARNING: 1, CRITICAL: 2 };
const PRESET_KEY = "pid-analyzer-presets";

/* ================= STORAGE HELPERS ================= */
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

/* ================= URL HELPERS (STEP 18) ================= */
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
            set: +p[idx(`setpoint[${i}]`)]
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
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [presets, setPresets] = useState(loadPresets());
  const [presetName, setPresetName] = useState("");
  const [error, setError] = useState("");

  /* Restore from URL (Step 18) */
  useEffect(() => {
    if (window.location.hash.length > 1) {
      const decoded = decodeReport(window.location.hash.slice(1));
      if (decoded) setReport(decoded);
    }
  }, []);

  /* Update URL when report changes */
  useEffect(() => {
    if (report) {
      window.location.hash = encodeReport(report);
    }
  }, [report]);

  /* Save preset */
  function savePreset() {
    if (!presetName || !report) return;
    const next = [
      ...presets,
      {
        id: Date.now(),
        name: presetName,
        report,
      },
    ];
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

  return (
    <div style={{ padding: 20, maxWidth: 860, margin: "auto" }}>
      <h1>PID Analyzer — Step 19 (Presets)</h1>

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
          <h2>
            Global Status:{" "}
            <span
              style={{
                color:
                  report.global === "CRITICAL"
                    ? "red"
                    : report.global === "WARNING"
                    ? "orange"
                    : "green"
              }}
            >
              {report.global}
            </span>
          </h2>

          <table border="1" cellPadding="6">
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

          {/* Save preset */}
          <div style={{ marginTop: 12 }}>
            <input
              placeholder="Preset name (e.g. Roll tune v2)"
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
            />
            <button onClick={savePreset} style={{ marginLeft: 8 }}>
              Save Preset
            </button>
          </div>
        </>
      )}

      {/* Presets */}
      {presets.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>Saved Presets</h3>
          <ul>
            {presets.map(p => (
              <li key={p.id}>
                <b>{p.name}</b>{" "}
                <button onClick={() => loadPreset(p)}>Load</button>
                <button
                  onClick={() => deletePreset(p.id)}
                  style={{ marginLeft: 6 }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {report && (
        <p style={{ marginTop: 12 }}>
          🔗 This report is encoded in the URL — copy the link to share it.
        </p>
      )}
    </div>
  );
}
