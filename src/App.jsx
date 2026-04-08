import { useState } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];
const SEVERITY_ORDER = { OK: 0, WARNING: 1, CRITICAL: 2 };

/* ================= CSV PARSER ================= */
function parseCSV(file, onSuccess, onError) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const lines = String(r.result).split(/\r?\n/).filter(Boolean);
      const delim = lines[0].includes(";") ? ";" :
                    lines[0].includes("\t") ? "\t" : ",";
      const headers = lines[0].split(delim);

      const idx = name => headers.indexOf(name);
      const t = idx("time");
      const map = axis => ({
        gyro: idx(`gyro[${axis}]`),
        set: idx(`setpoint[${axis}]`)
      });

      const data = lines.slice(1).map(l => {
        const p = l.split(delim);
        const entry = { time: +p[t] };
        AXES.forEach((a, i) => {
          entry[a] = {
            gyro: +p[map(i).gyro],
            set: +p[map(i).set]
          };
        });
        return entry;
      }).filter(r => !isNaN(r.time));

      onSuccess(data);
    } catch (e) {
      onError(e.message);
    }
  };
  r.readAsText(file);
}

/* ================= SIMPLE ANALYSIS ================= */
function analyze(data) {
  const result = {};
  let global = "OK";

  AXES.forEach(a => {
    const g = data.map(r => r[a].gyro);
    const s = data.map(r => r[a].set);
    const finalSet = s.at(-1);

    if (Math.abs(finalSet) < 1e-6) {
      result[a] = { severity: "OK", note: "Inactive" };
      return;
    }

    const peak = Math.max(...g);
    const overshoot = ((peak - finalSet) / Math.abs(finalSet)) * 100;

    let severity = "OK";
    if (overshoot > 15) severity = "WARNING";
    if (overshoot > 30) severity = "CRITICAL";

    if (SEVERITY_ORDER[severity] > SEVERITY_ORDER[global])
      global = severity;

    result[a] = {
      severity,
      overshoot: overshoot.toFixed(1),
    };
  });

  return { global, axes: result };
}

/* ================= DIFF ================= */
function diff(before, after) {
  return AXES.map(a => {
    const b = before.axes[a].severity;
    const f = after.axes[a].severity;
    let status = "No Change";

    if (SEVERITY_ORDER[f] < SEVERITY_ORDER[b]) status = "✅ Improved";
    if (SEVERITY_ORDER[f] > SEVERITY_ORDER[b]) status = "⚠️ Regressed";

    return {
      axis: a,
      before: b,
      after: f,
      status
    };
  });
}

/* ================= UI ================= */
export default function App() {
  const [baseData, setBaseData] = useState(null);
  const [candData, setCandData] = useState(null);
  const [error, setError] = useState("");

  const base = baseData && analyze(baseData);
  const cand = candData && analyze(candData);
  const delta = base && cand && diff(base, cand);

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: "auto" }}>
      <h1>PID Analyzer — Step 17 (Before / After)</h1>

      <label>
        Baseline log:
        <input type="file" onChange={e => parseCSV(e.target.files[0], setBaseData, setError)} />
      </label>

      <br /><br />

      <label>
        Candidate log:
        <input type="file" onChange={e => parseCSV(e.target.files[0], setCandData, setError)} />
      </label>

      {error && <div style={{ color: "red" }}>{error}</div>}

      {delta && (
        <>
          <h2>Summary</h2>
          <p>
            Baseline: <b>{base.global}</b> → Candidate: <b>{cand.global}</b>
          </p>

          <h2>Axis Comparison</h2>
          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th>Axis</th>
                <th>Before</th>
                <th>After</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {delta.map(d => (
                <tr key={d.axis}>
                  <td>{d.axis}</td>
                  <td>{d.before}</td>
                  <td>{d.after}</td>
                  <td>{d.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
