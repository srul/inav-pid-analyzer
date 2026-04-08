import { useState } from "react";

/* ================= CONFIG ================= */
const AXES = [
  { key: "roll", label: "Roll", gyro: "gyro[0]" },
  { key: "pitch", label: "Pitch", gyro: "gyro[1]" },
  { key: "yaw", label: "Yaw", gyro: "gyro[2]" },
];

const FFT_SAMPLES = 512;
const MIN_FREQ = 20; // ignore below 20 Hz

/* ================= CSV PARSER ================= */
function parseCSV(file, onSuccess, onError) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result);
      const lines = text.split(/\r?\n/).filter(l => l.trim().length);

      let delimiter = ",";
      if (lines[0].includes("\t")) delimiter = "\t";
      else if (lines[0].includes(";")) delimiter = ";";

      const headers = lines[0].split(delimiter).map(h => h.trim());
      const timeIdx = headers.indexOf("time");

      const idx = {
        roll: headers.indexOf("gyro[0]"),
        pitch: headers.indexOf("gyro[1]"),
        yaw: headers.indexOf("gyro[2]"),
      };

      if (timeIdx < 0 || Object.values(idx).some(i => i < 0)) {
        throw new Error("Required gyro columns not found");
      }

      const data = lines.slice(1)
        .map(l => {
          const p = l.split(delimiter);
          return {
            time: Number(p[timeIdx]),
            roll: Number(p[idx.roll]),
            pitch: Number(p[idx.pitch]),
            yaw: Number(p[idx.yaw]),
          };
        })
        .filter(r => Number.isFinite(r.time));

      onSuccess(data);
    } catch (e) {
      onError(e.message);
    }
  };
  reader.readAsText(file);
}

/* ================= FFT ================= */
function computeFFT(signal, sampleRate) {
  const N = signal.length;
  const out = [];

  for (let k = 0; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const ang = (2 * Math.PI * k * n) / N;
      re += signal[n] * Math.cos(ang);
      im -= signal[n] * Math.sin(ang);
    }
    const mag = Math.sqrt(re * re + im * im) / N;
    const freq = (k * sampleRate) / N;
    out.push({ freq, mag });
  }
  return out;
}

/* ================= NOTCH LOGIC ================= */
function recommendNotch(fft) {
  const candidates = fft.filter(p => p.freq > MIN_FREQ);
  if (candidates.length === 0) return null;

  const peak = candidates.reduce((a, b) => b.mag > a.mag ? b : a);
  const center = peak.freq;
  const bandwidth = center * 0.4; // ±20%

  return {
    centerHz: center,
    bandwidthHz: bandwidth,
    note:
      center < 150
        ? "Likely motor / prop vibration"
        : "Likely mechanical or resonance vibration",
  };
}

/* ================= APP ================= */
export default function App() {
  const [data, setData] = useState(null);
  const [axis, setAxis] = useState("roll");
  const [error, setError] = useState("");

  const fft =
    data &&
    (() => {
      const tail = data.slice(-FFT_SAMPLES);
      if (tail.length < FFT_SAMPLES) return null;
      const dt = tail[1].time - tail[0].time;
      const fs = 1 / dt;
      const sig = tail.map(r => r[axis]);
      return computeFFT(sig, fs);
    })();

  const notch = fft && recommendNotch(fft);

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 9 (Notch Recommendation)</h1>

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

          {fft && (
            <>
              <h3 style={{ marginTop: 20 }}>Frequency Spectrum</h3>

              <svg
                width={800}
                height={300}
                style={{ border: "1px solid #ccc", background: "#fafafa" }}
              >
                {fft.map((p, i) => {
                  if (p.freq > 500) return null;
                  const x = (p.freq / 500) * 800;
                  const y = 300 - p.mag * 200;
                  return (
                    <line
                      key={i}
                      x1={x}
                      x2={x}
                      y1={300}
                      y2={y}
                      stroke={notch && Math.abs(p.freq - notch.centerHz) < 2
                        ? "red"
                        : "#444"}
                    />
                  );
                })}
              </svg>
            </>
          )}

          {notch && (
            <div style={{ marginTop: 20 }}>
              <h3>Notch Filter Recommendation</h3>
              <ul>
                <li><b>Center Frequency:</b> {notch.centerHz.toFixed(1)} Hz</li>
                <li>
                  <b>Bandwidth:</b> ±{(notch.bandwidthHz / 2).toFixed(1)} Hz
                </li>
                <li><b>Diagnosis:</b> {notch.note}</li>
              </ul>
              <div style={{ marginTop: 6, color: "#555" }}>
                Recommendation is based on dominant vibration peak.
                Validate mechanically before applying aggressive filtering.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
