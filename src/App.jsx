// STEP 13 — FIXED (Crash‑Proof)
import { useState } from "react";

const AXES = [
  { key: "roll", label: "Roll" },
  { key: "pitch", label: "Pitch" },
  { key: "yaw", label: "Yaw" },
];

const FFT_SAMPLES = 512;
const MIN_VIB_FREQ = 20;

/* ================= CSV ================= */
function parseCSV(file, ok, err) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const l = String(r.result).split(/\r?\n/).filter(Boolean);
      let d = ",";
      if (l[0].includes("\t")) d = "\t";
      else if (l[0].includes(";")) d = ";";

      const h = l[0].split(d);
      const ti = h.indexOf("time");
      const g = {
        roll: h.indexOf("gyro[0]"),
        pitch: h.indexOf("gyro[1]"),
        yaw: h.indexOf("gyro[2]"),
        rollSp: h.indexOf("setpoint[0]"),
        pitchSp: h.indexOf("setpoint[1]"),
        yawSp: h.indexOf("setpoint[2]"),
      };

      if (ti < 0 || Object.values(g).some(v => v < 0))
        throw new Error("Missing required columns");

      ok(
        l.slice(1)
          .map(r => {
            const p = r.split(d);
            return {
              time: +p[ti],
              roll: { gyro: +p[g.roll], set: +p[g.rollSp] },
              pitch: { gyro: +p[g.pitch], set: +p[g.pitchSp] },
              yaw: { gyro: +p[g.yaw], set: +p[g.yawSp] },
            };
          })
          .filter(r => !isNaN(r.time))
      );
    } catch (e) {
      err(e.message);
    }
  };
  r.readAsText(file);
}

/* ================= METRICS ================= */
function computeMetrics(d, a) {
  const g = d.map(r => r[a].gyro);
  const s = d.map(r => r[a].set);
  const t = d.map(r => r.time);
  const fs = s.at(-1);

  if (Math.abs(fs) < 1e-6) return { inactive: true };

  const peak = Math.max(...g);
  const overshoot = ((peak - fs) / Math.abs(fs)) * 100;

  const tail = Math.floor(g.length * 0.9);
  const sse =
    g.slice(tail).reduce((a, v, i) => a + (v - s[tail + i]), 0) /
    (g.length - tail);

  return { overshoot, sse, inactive: false };
}

/* ================= STEP 13 ENGINE ================= */
function buildAxisResult(metrics) {
  if (metrics.inactive) {
    return { severity: "OK", cards: [{ title: "Inactive Axis" }] };
  }

  const cards = [];
  let severity = "OK";

  if (metrics.overshoot > 15) {
    cards.push({ title: "High Overshoot", severity: "WARNING" });
    severity = "WARNING";
  }

  if (Math.abs(metrics.sse) > 0.05) {
    cards.push({ title: "Steady‑State Error", severity: "WARNING" });
    severity = "WARNING";
  }

  if (!cards.length) {
    cards.push({ title: "Tune Looks Balanced", severity: "OK" });
  }

  return { severity, cards };
}

/* ================= APP ================= */
export default function App() {
  const [data, setData] = useState(null);
  const [axis, setAxis] = useState("roll");
  const [err, setErr] = useState("");

  // ✅ build axisResults ONLY if data exists
  const axisResults = data
    ? Object.fromEntries(
        AXES.map(a => [
          a.key,
          buildAxisResult(computeMetrics(data, a.key)),
        ])
      )
    : null;

  // ✅ SAFE global severity
  const globalSeverity = axisResults
    ? Object.values(axisResults).some(r => r.severity === "CRITICAL")
      ? "CRITICAL"
      : Object.values(axisResults).some(r => r.severity === "WARNING")
      ? "WARNING"
      : "OK"
    : null;

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 13 (Fixed)</h1>

      <input
        type="file"
        accept=".csv"
        onChange={e => parseCSV(e.target.files[0], setData, setErr)}
      />

      {err && <div style={{ color: "red" }}>{err}</div>}

      {globalSeverity && (
        <h2>
          {globalSeverity === "CRITICAL"
            ? "🔴 Tune Needs Attention"
            : globalSeverity === "WARNING"
            ? "🟡 Tune Has Warnings"
            : "✅ Tune Looks Good"}
        </h2>
      )}

      {axisResults && (
        <>
          {AXES.map(a => (
            <button key={a.key} onClick={() => setAxis(a.key)}>
              {a.label}: {axisResults[a.key].severity}
            </button>
          ))}

          <ul>
            {axisResults[axis].cards.map((c, i) => (
              <li key={i}>{c.title}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
