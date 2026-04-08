import { useState } from "react";

/* ================= CONFIG ================= */
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

  const band = Math.abs(fs) * 0.05;
  let settle = null;
  for (let i = 0; i < g.length; i++)
    if (
      Math.abs(g[i] - fs) <= band &&
      g.slice(i).every(v => Math.abs(v - fs) <= band)
    ) {
      settle = t[i];
      break;
    }

  return { overshoot, sse, settle };
}

/* ================= FFT ================= */
function fft(sig, fs) {
  const N = sig.length;
  return Array.from({ length: N / 2 }, (_, k) => {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const a = (2 * Math.PI * k * n) / N;
      re += sig[n] * Math.cos(a);
      im -= sig[n] * Math.sin(a);
    }
    return { f: (k * fs) / N, m: Math.hypot(re, im) / N };
  });
}

/* ================= STEP 13 RULE ENGINE ================= */
function buildCardsAndSeverity(m, vibHz) {
  if (m.inactive) {
    return {
      severity: "OK",
      cards: [{
        severity: "OK",
        title: "Inactive Axis",
        body: "No meaningful setpoint activity detected.",
      }],
    };
  }

  const cards = [];
  let globalSeverity = "OK";

  if (vibHz > 80) {
    cards.push({
      severity: "CRITICAL",
      title: "Enable Harmonic Notch Filter",
      body:
        `Strong vibration detected at ~${vibHz.toFixed(1)} Hz. ` +
        "Motor noise enters D‑term and limits achievable gains.",
      params: [
        "INS_HNTCH_ENABLE = 1",
        "INS_HNTCH_MODE = 4 (FFT)",
        `INS_HNTCH_FREQ ≈ ${vibHz.toFixed(1)}`,
        `INS_HNTCH_BW ≈ ${(vibHz * 0.5).toFixed(1)}`,
      ],
    });
    globalSeverity = "CRITICAL";
  }

  if (m.overshoot > 15) {
    cards.push({
      severity: "WARNING",
      title: "High Overshoot",
      body: "Aggressive response with excessive overshoot.",
      params: ["Reduce Rate P by ~5–10%"],
    });
    if (globalSeverity !== "CRITICAL") globalSeverity = "WARNING";
  }

  if (Math.abs(m.sse) > 0.05) {
    cards.push({
      severity: "WARNING",
      title: "Steady‑State Error",
      body: "Controller does not converge perfectly.",
      params: ["Increase Rate I slowly"],
    });
    if (globalSeverity !== "CRITICAL") globalSeverity = "WARNING";
  }

  if (!cards.length) {
    cards.push({
      severity: "OK",
      title: "Tune Looks Balanced",
      body: "No critical PID issues detected.",
    });
  }

  return { severity: globalSeverity, cards };
}

/* ================= UI ================= */
function Card({ severity, title, body, params }) {
  const c =
    severity === "CRITICAL" ? "#dc2626" :
    severity === "WARNING" ? "#f59e0b" :
    "#16a34a";

  return (
    <div style={{
      borderLeft: `6px solid ${c}`,
      background: "#020617",
      color: "#e5e7eb",
      padding: 14,
      marginBottom: 12,
      borderRadius: 6,
    }}>
      <b style={{ color: c }}>{severity}</b>
      <div style={{ fontSize: 16, marginTop: 6 }}>{title}</div>
      <div style={{ color: "#9ca3af", marginTop: 6 }}>{body}</div>

      {params && (
        <ul style={{ marginTop: 8 }}>
          {params.map((p, i) => (
            <li key={i} style={{ fontFamily: "monospace" }}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ================= APP ================= */
export default function App() {
  const [data, setData] = useState(null);
  const [axis, setAxis] = useState("roll");
  const [err, setErr] = useState("");

  const axisResults =
    data &&
    Object.fromEntries(
      AXES.map(a => {
        const m = computeMetrics(data, a.key);
        let vib = 0;

        if (!m.inactive) {
          const t = data.slice(-FFT_SAMPLES);
          if (t.length >= FFT_SAMPLES) {
            const fs = 1 / (t[1].time - t[0].time);
            vib = fft(t.map(r => r[a.key].gyro), fs)
              .filter(p => p.f > MIN_VIB_FREQ)
              .reduce((x, y) => y.m > x.m ? y : x, { f: 0 }).f;
          }
        }

        const res = buildCardsAndSeverity(m, vib);
        return [a.key, res];
      })
    );

  const globalSeverity =
    axisResults &&
    Object.values(axisResults).some(r => r.severity === "CRITICAL")
      ? "CRITICAL"
      : Object.values(axisResults).some(r => r.severity === "WARNING")
        ? "WARNING"
        : "OK";

  return (
    <div style={{ padding: 20, background: "#020617", minHeight: "100vh" }}>
      <h1 style={{ color: "#e5e7eb" }}>PID Analyzer — Step 13</h1>

      <input
        type="file"
        accept=".csv"
        onChange={e => parseCSV(e.target.files[0], setData, setErr)}
      />

      {err && <div style={{ color: "#dc2626" }}>{err}</div>}

      {axisResults && (
        <>
          {/* SUMMARY */}
          <div style={{
            marginTop: 20,
            padding: 16,
            background: "#020617",
            border: "1px solid #334155",
            borderRadius: 6,
          }}>
            <h2 style={{
              color:
                globalSeverity === "CRITICAL" ? "#dc2626" :
                globalSeverity === "WARNING" ? "#f59e0b" :
                "#16a34a",
            }}>
              {globalSeverity === "CRITICAL"
                ? "Tune Needs Attention"
                : globalSeverity === "WARNING"
                  ? "Tune Has Warnings"
                  : "Tune Looks Good"}
            </h2>

            <div style={{ marginTop: 8 }}>
              {AXES.map(a => (
                <span key={a.key}
                  style={{
                    marginRight: 12,
                    padding: "4px 8px",
                    borderRadius: 4,
                    background:
                      axisResults[a.key].severity === "CRITICAL"
                        ? "#dc2626"
                        : axisResults[a.key].severity === "WARNING"
                          ? "#f59e0b"
                          : "#16a34a",
                    color: "#020617",
                  }}>
                  {a.label}: {axisResults[a.key].severity}
                </span>
              ))}
            </div>
          </div>

          {/* AXIS SELECT */}
          <div style={{ marginTop: 14 }}>
            {AXES.map(a => (
              <button
                key={a.key}
                onClick={() => setAxis(a.key)}
                style={{
                  marginRight: 6,
                  background: axis === a.key ? "#334155" : "#020617",
                  color: "#e5e7eb",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* CARDS */}
          <div style={{ marginTop: 20 }}>
            {axisResults[axis].cards.map((c, i) => (
              <Card key={i} {...c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
``
