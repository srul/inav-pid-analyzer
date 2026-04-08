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
function parseCSV(file, onSuccess, onError) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const l = String(r.result).split(/\r?\n/).filter(Boolean);
      let d = ",";
      if (l[0].includes("\t")) d = "\t";
      if (l[0].includes(";")) d = ";";

      const h = l[0].split(d);
      const t = h.indexOf("time");
      const g = {
        roll: h.indexOf("gyro[0]"),
        pitch: h.indexOf("gyro[1]"),
        yaw: h.indexOf("gyro[2]"),
        rollSp: h.indexOf("setpoint[0]"),
        pitchSp: h.indexOf("setpoint[1]"),
        yawSp: h.indexOf("setpoint[2]"),
      };
      if (t < 0 || Object.values(g).some(v => v < 0))
        throw new Error("Missing required columns");

      const data = l.slice(1).map(r => {
        const p = r.split(d);
        return {
          time: +p[t],
          roll: { gyro: +p[g.roll], set: +p[g.rollSp] },
          pitch: { gyro: +p[g.pitch], set: +p[g.pitchSp] },
          yaw: { gyro: +p[g.yaw], set: +p[g.yawSp] },
        };
      }).filter(r => !isNaN(r.time));

      onSuccess(data);
    } catch (e) {
      onError(e.message);
    }
  };
  r.readAsText(file);
}

/* ================= METRICS ================= */
function metrics(data, a) {
  const g = data.map(r => r[a].gyro);
  const s = data.map(r => r[a].set);
  const t = data.map(r => r.time);
  const fs = s.at(-1);

  if (Math.abs(fs) < 1e-6) return { inactive: true };

  const peak = Math.max(...g);
  const over = ((peak - fs) / Math.abs(fs)) * 100;

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

  return { over, sse, settle };
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

/* ================= STEP 11 CARDS ================= */
function buildRecommendationCards(m, vibHz) {
  if (m.inactive) {
    return [{
      severity: "OK",
      title: "No Control Activity Detected",
      body:
        "No significant setpoint change on this axis. PID tuning advice is not applicable.",
    }];
  }

  const cards = [];

  if (vibHz > 80) {
    cards.push({
      severity: "CRITICAL",
      title: "Enable Harmonic Notch Filter",
      body:
        `Strong vibration detected at ~${vibHz.toFixed(1)} Hz. ` +
        "Motor noise is entering the control loop and limiting achievable gains.",
      params: [
        "Set notch center frequency",
        "Configure bandwidth ~½ of frequency",
        "Apply before PID changes",
      ],
    });
  }

  if (m.over > 15)
    cards.push({
      severity: "WARNING",
      title: "High Overshoot",
      body:
        "System response is aggressive and overshoots the target.",
      params: ["Reduce P slightly (5–10%)"],
    });

  if (Math.abs(m.sse) > 0.05)
    cards.push({
      severity: "WARNING",
      title: "Steady-State Error Detected",
      body:
        "Controller does not fully converge to the target.",
      params: ["Increase I slowly"],
    });

  if (!cards.length)
    cards.push({
      severity: "OK",
      title: "PID Tune Looks Balanced",
      body:
        "No critical issues detected. Current tuning appears reasonable.",
    });

  return cards;
}

/* ================= UI CARD ================= */
function Card({ severity, title, body, params }) {
  const color =
    severity === "CRITICAL" ? "#e53935" :
    severity === "WARNING" ? "#ffa726" :
    "#43a047";

  return (
    <div style={{
      borderLeft: `6px solid ${color}`,
      background: "#111827",
      color: "#e5e7eb",
      padding: 14,
      marginBottom: 12,
      borderRadius: 6,
    }}>
      <b style={{ color }}>{severity}</b>
      <div style={{ fontSize: 16, marginTop: 6 }}>{title}</div>
      <div style={{ color: "#9ca3af", marginTop: 6 }}>{body}</div>
      {params && (
        <ul style={{ marginTop: 8 }}>
          {params.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}
    </div>
  );
}

/* ================= APP ================= */
export default function App() {
  const [data, setData] = useState(null);
  const [axis, setAxis] = useState("roll");
  const [error, setError] = useState("");

  const m = data && metrics(data, axis);

  const vib =
    data &&
    (() => {
      const t = data.slice(-FFT_SAMPLES);
      if (t.length < FFT_SAMPLES) return 0;
      const fs = 1 / (t[1].time - t[0].time);
      return fft(t.map(r => r[axis].gyro), fs)
        .filter(p => p.f > MIN_VIB_FREQ)
        .reduce((a, b) => b.m > a.m ? b : a, { f: 0 }).f;
    })();

  const cards = m && buildRecommendationCards(m, vib);

  return (
    <div style={{ padding: 20, background: "#020617", minHeight: "100vh" }}>
      <h1 style={{ color: "#e5e7eb" }}>
        PID Analyzer — Step 11 (Diagnostics UI)
      </h1>

      <input
        type="file"
        accept=".csv"
        onChange={e => parseCSV(e.target.files[0], setData, setError)}
      />

      <div style={{ marginTop: 10 }}>
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

      {error && <div style={{ color: "red" }}>{error}</div>}

      {cards && (
        <div style={{ marginTop: 20 }}>
          {cards.map((c, i) => <Card key={i} {...c} />)}
        </div>
      )}
    </div>
  );
}
``
