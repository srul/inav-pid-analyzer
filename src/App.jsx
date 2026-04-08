import { useState } from "react";

/* ========== CONFIG ========== */
const AXES = [
  { key: "roll", label: "Roll", gyro: "gyro[0]", set: "setpoint[0]" },
  { key: "pitch", label: "Pitch", gyro: "gyro[1]", set: "setpoint[1]" },
  { key: "yaw", label: "Yaw", gyro: "gyro[2]", set: "setpoint[2]" },
];

const FFT_SAMPLES = 512; // power of 2 recommended

/* ========== HELPERS ========== */

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
        roll: {
          gyro: headers.indexOf("gyro[0]"),
          set: headers.indexOf("setpoint[0]"),
        },
        pitch: {
          gyro: headers.indexOf("gyro[1]"),
          set: headers.indexOf("setpoint[1]"),
        },
        yaw: {
          gyro: headers.indexOf("gyro[2]"),
          set: headers.indexOf("setpoint[2]"),
        },
      };

      if (timeIdx < 0 || Object.values(idx).some(a => a.gyro < 0 || a.set < 0))
        throw new Error("Missing required columns");

      const data = lines.slice(1).map(line => {
        const p = line.split(delimiter);
        return {
          time: Number(p[timeIdx]),
          roll: { gyro: Number(p[idx.roll.gyro]) },
          pitch: { gyro: Number(p[idx.pitch.gyro]) },
          yaw: { gyro: Number(p[idx.yaw.gyro]) },
        };
      }).filter(r => Number.isFinite(r.time));

      onSuccess(data);
    } catch (e) {
      onError(e.message);
    }
  };
  reader.readAsText(file);
}

/* ===== FFT (simple DFT, magnitude only) ===== */

function computeFFT(signal, sampleRate) {
  const N = signal.length;
  const result = [];

  for (let k = 0; k < N / 2; k++) {
    let real = 0, imag = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      real += signal[n] * Math.cos(angle);
      imag -= signal[n] * Math.sin(angle);
    }
    const magnitude = Math.sqrt(real * real + imag * imag) / N;
    const freq = (k * sampleRate) / N;
    result.push({ freq, magnitude });
  }
  return result;
}

/* ========== APP ========== */

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

      const signal = tail.map(r => r[axis].gyro);
      return computeFFT(signal, fs);
    })();

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 8 (FFT / Vibration)</h1>

      <input
        type="file"
        accept=".csv"
        onChange={e =>
          parseCSV(e.target.files[0], setData, setError)
        }
      />

      {error && <div style={{ color: "red" }}>❌ {error}</div>}

      {data && (
        <>
          <div style={{ marginTop: 12 }}>
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
                  const x = (p.freq / 500) * 800; // up to 500 Hz displayed
                  const y = 300 - p.magnitude * 200;
                  return (
                    <line
                      key={i}
                      x1={x}
                      x2={x}
                      y1={300}
                      y2={y}
                      stroke="#444"
                    />
                  );
                })}
              </svg>

              <div style={{ marginTop: 10 }}>
                <b>Dominant frequency:</b>{" "}
                {fft
                  .reduce((a, b) => (b.magnitude > a.magnitude ? b : a))
                  .freq.toFixed(1)}{" "}
                Hz
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
