import { useState } from "react";

/* ================= CONFIG ================= */
const AXES = [
  { key: "roll", label: "Roll" },
  { key: "pitch", label: "Pitch" },
  { key: "yaw", label: "Yaw" },
];

const FFT_SAMPLES = 512;
const MIN_VIB_FREQ = 20;

/* ================= CSV PARSER ================= */
function parseCSV(file, onSuccess, onError) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result);
      const lines = text.split(/\r?\n/).filter(l => l.trim());

      let delimiter = ",";
      if (lines[0].includes("\t")) delimiter = "\t";
      else if (lines[0].includes(";")) delimiter = ";";

      const headers = lines[0].split(delimiter).map(h => h.trim());

      const timeIdx = headers.indexOf("time");
      const idx = {
        roll: headers.indexOf("gyro[0]"),
        pitch: headers.indexOf("gyro[1]"),
        yaw: headers.indexOf("gyro[2]"),
        rollSp: headers.indexOf("setpoint[0]"),
        pitchSp: headers.indexOf("setpoint[1]"),
        yawSp: headers.indexOf("setpoint[2]"),
      };

      if (timeIdx < 0 || Object.values(idx).some(v => v < 0)) {
        throw new Error("Required gyro/setpoint columns missing");
      }

      const data = lines.slice(1).map(l => {
        const p = l.split(delimiter);
        return {
          time: Number(p[timeIdx]),
          roll: { gyro: Number(p[idx.roll]), set: Number(p[idx.rollSp]) },
          pitch: { gyro: Number(p[idx.pitch]), set: Number(p[idx.pitchSp]) },
          yaw: { gyro: Number(p[idx.yaw]), set: Number(p[idx.yawSp]) },
        };
      }).filter(r => Number.isFinite(r.time));

      onSuccess(data);
    } catch (e) {
      onError(e.message);
    }
  };
  reader.readAsText(file);
}

/* ================= METRICS ================= */
function computeMetrics(data, axis) {
  const g = data.map(r => r[axis].gyro);
  const s = data.map(r => r[axis].set);
  const t = data.map(r => r.time);

  const finalSet = s[s.length - 1];

  // ✅ FIX: handle inactive axis explicitly
  if (Math.abs(finalSet) < 1e-6) {
    return {
      overshootPct: 0,
      sse: 0,
      settlingTime: null,
      inactive: true,
    };
  }

  const peak = Math.max(...g);
  const overshootPct = ((peak - finalSet) / Math.abs(finalSet)) * 100;

  const tailStart = Math.floor(g.length * 0.9);
  const sse =
    g.slice(tailStart)
      .map((v, i) => v - s[tailStart + i])
      .reduce((a, b) => a + b, 0) /
    (g.length - tailStart);

  const band = Math.abs(finalSet) * 0.05;
  let settlingTime = null;
  for (let i = 0; i < g.length; i++) {
    if (
      Math.abs(g[i] - finalSet) <= band &&
      g.slice(i).every(v => Math.abs(v - finalSet) <= band)
    ) {
      settlingTime = t[i];
      break;
    }
  }

  return { overshootPct, sse, settlingTime, inactive: false };
}

/* ================= FFT ================= */
function computeFFT(signal, fs) {
  const N = signal.length;
  const out = [];
  for (let k = 0; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const a = (2 * Math.PI * k * n) / N;
      re += signal[n] * Math.cos(a);
      im -= signal[n] * Math.sin(a);
    }
    out.push({
      freq: (k * fs) / N,
      mag: Math.sqrt(re * re + im * im) / N,
    });
  }
  return out;
}

/* ================= NOTCH ================= */
function recommendNotch(fft) {
  const vib = fft.filter(p => p.freq > MIN_VIB_FREQ);
  if (!vib.length) return null;
  const peak = vib.reduce((a, b) => (b.mag > a.mag ? b : a));
  return {
    freq: peak.freq,
    bw: peak.freq * 0.4,
  };
}

/* ================= PID ADVICE ================= */
function derivePidAdvice(metrics, notch) {
  // ✅ FIX: inactive axis explanation
  if (metrics.inactive) {
    return [{
      term: "Inactive Axis",
      text: "No significant setpoint change detected on this axis.",
      action:
        "PID tuning advice is not applicable. Analyze Roll axis or log a maneuver for this axis.",
    }];
  }

  const advice = [];

  if (notch) {
    advice.push({
      term: "Prerequisite",
      text: `Vibration detected at ~${notch.freq.toFixed(1)} Hz.`,
      action: "Apply notch filter before changing PID gains.",
    });
  }

  if (metrics.overshootPct > 15) {
    advice.push({
      term: "P",
      text: "Overshoot is high → loop is aggressive.",
      action: "Reduce P slightly (≈ −5% to −10%).",
    });
  } else if (metrics.overshootPct < 5 && metrics.settlingTime > 0.3) {
    advice.push({
      term: "P",
      text: "Response is slow with low overshoot.",
      action: "Increase P slightly to improve response.",
    });
  }

  if (Math.abs(metrics.sse) > 0.05) {
    advice.push({
      term: "I",
      text: "Steady‑state error present.",
      action: "Increase I slowly to remove residual error.",
    });
  }

  if (metrics.overshootPct > 10 && notch) {
    advice.push({
      term: "D",
      text: "Overshoot remains after vibration control.",
      action: "Increase D slightly to improve damping.",
    });
  }

  if (!advice.length) {
    advice.push({
      term: "Stable",
      text: "System response looks balanced.",
      action: "No PID changes recommended.",
    });
  }

  return advice;
}

/* ================= APP ================= */
export default function App() {
  const [data, setData] = useState(null);
  const [axis, setAxis] = useState("roll");
  const [error, setError] = useState("");

  const metrics = data && computeMetrics(data, axis);

  const fft =
    data &&
    (() => {
      const tail = data.slice(-FFT_SAMPLES);
      if (tail.length < FFT_SAMPLES) return null;
      const dt = tail[1].time - tail[0].time;
      return computeFFT(tail.map(r => r[axis].gyro), 1 / dt);
    })();

  const notch = fft && recommendNotch(fft);
  const pidAdvice = metrics && derivePidAdvice(metrics, notch);

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 10 (PID Recommendations)</h1>

      <input
        type="file"
        accept=".csv"
        onChange={e => parseCSV(e.target.files[0], setData, setError)}
      />

      {error && <div style={{ color: "red" }}>❌ {error}</div>}

      {data && (
        <>
          <div style={{ marginTop: 10 }}>
            Axis:&nbsp;
            {AXES.map(a => (
              <button
                key={a.key}
                onClick={() => setAxis(a.key)}
                style={{
                  marginRight: 6,
                  background: axis === a.key ? "#ddd" : "#fff",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 15 }}>
            <h3>Metrics</h3>
            {metrics.inactive ? (
              <div style={{ color: "#666" }}>
                No step response detected for this axis.
              </div>
            ) : (
              <ul>
                <li>Overshoot: {metrics.overshootPct.toFixed(2)}%</li>
                <li>SSE: {metrics.sse.toFixed(3)}</li>
                <li>
                  Settling Time:{" "}
                  {metrics.settlingTime
                    ? metrics.settlingTime.toFixed(3) + " s"
                    : "Not settled"}
                </li>
              </ul>
            )}
          </div>

          {pidAdvice && (
            <div style={{ marginTop: 20 }}>
              <h3>PID Tuning Advice</h3>
              <ul>
                {pidAdvice.map((a, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    <b>{a.term}</b>: {a.text}
                    <br />
                    👉 {a.action}
                  </li>
                ))}
              </ul>
              <div style={{ fontSize: 12, color: "#666" }}>
                Apply changes incrementally and re‑test after each adjustment.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
``
