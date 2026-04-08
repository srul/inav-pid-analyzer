import { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import "./App.css";

/* ====================== CONSTANTS ====================== */

const AXES = [
  { key: "roll", label: "Roll", color: "#ef4444" },
  { key: "pitch", label: "Pitch", color: "#22c55e" },
  { key: "yaw", label: "Yaw", color: "#3b82f6" },
];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/* ====================== CSV HELPERS ====================== */

const norm = (h) => String(h ?? "").trim().toLowerCase();

function guessColumns(headers) {
  const h = headers.map(norm);
  const pick = (arr) => arr.map((x) => headers[h.indexOf(x)]).filter(Boolean);

  return {
    time: headers[h.indexOf("time")] || headers[h.indexOf("time_us")] || headers[0],
    gyro: pick(["gyro[0]", "gyro[1]", "gyro[2]"]),
    set: pick(["setpoint[0]", "setpoint[1]", "setpoint[2]", "rccommand[0]"]),
  };
}

/* ====================== NUMERICS ====================== */

function rms(arr) {
  const v = arr.filter(isNum);
  if (!v.length) return 0;
  return Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
}

/* ====================== TIME DOMAIN METRICS ====================== */

function stepResponseMetrics(sp, gy) {
  const n = Math.min(sp.length, gy.length);
  if (n < 100) return null;

  const steps = [];
  for (let i = 1; i < n; i++) {
    if (Math.abs(sp[i] - sp[i - 1]) > 5) steps.push(i);
  }
  if (!steps.length) return { overshoot_pct: 0, settle_ms: null, sse: 0 };

  const overs = [];
  const settles = [];
  const sse = [];

  steps.slice(0, 3).forEach((idx) => {
    const target = sp[idx];
    const seg = gy.slice(idx, idx + 300);

    const peak = Math.max(...seg);
    overs.push(Math.max(0, ((peak - target) / Math.abs(target)) * 100));

    let settle = null;
    for (let i = 0; i < seg.length; i++) {
      if (Math.abs(seg[i] - target) < Math.abs(target) * 0.05) {
        settle = i;
        break;
      }
    }
    if (settle != null) settles.push(settle);

    const tail = seg.slice(-20);
    sse.push(tail.reduce((a, b) => a + b, 0) / tail.length - target);
  });

  return {
    overshoot_pct: overs.reduce((a, b) => a + b, 0) / overs.length,
    settle_ms: settles.length ? settles.reduce((a, b) => a + b, 0) / settles.length : null,
    sse: sse.reduce((a, b) => a + b, 0) / sse.length,
  };
}

/* ====================== SCORE ====================== */

function computeTuneScore(m) {
  let s = 100;
  if (m.overshoot_pct > 20) s -= 25;
  else if (m.overshoot_pct > 10) s -= 15;

  if (m.settle_ms > 500) s -= 20;
  else if (m.settle_ms > 350) s -= 10;

  if (m.noise_rms > 18) s -= 20;
  else if (m.noise_rms > 12) s -= 10;

  if (Math.abs(m.sse) > 2) s -= 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/* ====================== FFT ====================== */

// Radix‑2 FFT magnitude (real input)
function fftMagnitude(signal) {
  const N = signal.length;
  if (N & (N - 1)) return null;

  const real = signal.slice();
  const imag = new Array(N).fill(0);

  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const wr = Math.cos(ang * j);
        const wi = Math.sin(ang * j);
        const r = real[i + j + len / 2];
        const im = imag[i + j + len / 2];

        const tr = wr * r - wi * im;
        const ti = wr * im + wi * r;

        real[i + j + len / 2] = real[i + j] - tr;
        imag[i + j + len / 2] = imag[i + j] - ti;
        real[i + j] += tr;
        imag[i + j] += ti;
      }
    }
  }

  return real.slice(0, N / 2).map((r, i) =>
    Math.sqrt(r * r + imag[i] * imag[i])
  );
}

function computeFFT(signal, sampleRateHz = 1000) {
  const N = 2048;
  if (signal.length < N) return null;
  const slice = signal.slice(-N);

  // Hanning window
  const windowed = slice.map(
    (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)))
  );

  const mag = fftMagnitude(windowed);
  if (!mag) return null;

  const freqs = mag.map((_, i) => (i * sampleRateHz) / N);
  return { freqs, mag };
}

function detectPeaks(freqs, mag) {
  const peaks = [];
  for (let i = 1; i < mag.length - 1; i++) {
    if (mag[i] > mag[i - 1] && mag[i] > mag[i + 1] && mag[i] > 5) {
      peaks.push({ freq: freqs[i], amp: mag[i] });
    }
  }
  return peaks.sort((a, b) => b.amp - a.amp).slice(0, 3);
}

function classifyVibration(peaks) {
  if (!peaks.length) return { level: "low", text: "No dominant vibration detected" };
  const p = peaks[0];
  if (p.amp > 50)
    return { level: "high", text: `High vibration at ${p.freq.toFixed(1)} Hz (motor/prop)` };
  if (p.amp > 20)
    return { level: "moderate", text: `Moderate vibration around ${p.freq.toFixed(1)} Hz` };
  return { level: "low", text: "Minor vibration only" };
}

/* ====================== ANALYSIS ====================== */

function analyzeCSV(file) {
  if (!file) return null;
  const { rows, cols } = file;
  const out = {};

  AXES.forEach((a, i) => {
    const gy = rows.map((r) => r[cols.gyro[i]]).filter(isNum);
    const sp = rows.map((r) => r[cols.set[i]]).filter(isNum);
    if (!gy.length || !sp.length) return;

    const m = stepResponseMetrics(sp, gy);
    m.noise_rms = rms(gy.filter((_, i) => Math.abs(sp[i] ?? 0) < 5));
    m.score = computeTuneScore(m);

    const fft = computeFFT(gy);
    if (fft) {
      const peaks = detectPeaks(fft.freqs, fft.mag);
      m.fft = fft;
      m.peaks = peaks;
      m.vibration = classifyVibration(peaks);
    }

    m.gyro = gy;
    m.set = sp;
    out[a.key] = m;
  });

  return out;
}

/* ====================== APP ====================== */

export default function App() {
  const [baseline, setBaseline] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [axis, setAxis] = useState("roll");

  function loadFile(e, setter) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const lines = String(r.result).split(/\r?\n/).filter(Boolean);
      const headers = lines[0].split(",");
      const rows = lines.slice(1).map((l) => {
        const v = l.split(",");
        const o = {};
        headers.forEach((h, i) => {
          const n = Number(v[i]);
          o[h] = Number.isFinite(n) ? n : null;
        });
        return o;
      });
      setter({ rows, headers, cols: guessColumns(headers), name: f.name });
    };
    r.readAsText(f);
  }

  const before = useMemo(() => analyzeCSV(baseline), [baseline]);
  const after = useMemo(() => analyzeCSV(candidate), [candidate]);

  const plotData =
    before && after && after[axis]
      ? [
          { y: before[axis].gyro, name: "Baseline Gyro", type: "scattergl" },
          { y: after[axis].gyro, name: "Candidate Gyro", type: "scattergl" },
          { y: before[axis].set, name: "Baseline Setpoint", dash: "dash", type: "scattergl" },
          { y: after[axis].set, name: "Candidate Setpoint", dash: "dash", type: "scattergl" },
        ]
      : [];

  return (
    <div className="app">
      <h1>PID Analyzer — Compare & FFT</h1>

      <div style={{ display: "flex", gap: 20 }}>
        <div>
          <h3>Baseline</h3>
          <input type="file" onChange={(e) => loadFile(e, setBaseline)} />
          {baseline?.name}
        </div>
        <div>
          <h3>Candidate</h3>
          <input type="file" onChange={(e) => loadFile(e, setCandidate)} />
          {candidate?.name}
        </div>
      </div>

      {after && (
        <div style={{ marginTop: 20 }}>
          Axis:&nbsp;
          {AXES.map((a) => (
            <button key={a.key} onClick={() => setAxis(a.key)}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {before && after && (
        <>
          <Plot
            data={plotData}
            layout={{ title: "Time Domain Compare", height: 400 }}
            style={{ width: "100%" }}
          />

          <h3>FFT — {axis.toUpperCase()}</h3>

          {after[axis].fft && (
            <>
              <Plot
                data={[
                  {
                    x: after[axis].fft.freqs,
                    y: after[axis].fft.mag,
                    type: "scatter",
                  },
                ]}
                layout={{
                  xaxis: { title: "Frequency (Hz)", range: [0, 300] },
                  yaxis: { title: "Magnitude" },
                  height: 300,
                }}
                style={{ width: "100%" }}
              />

              <div>
                <b>Vibration Risk:</b>{" "}
                <span
                  style={{
                    color:
                      after[axis].vibration.level === "high"
                        ? "red"
                        : after[axis].vibration.level === "moderate"
                        ? "orange"
                        : "green",
                  }}
                >
                  {after[axis].vibration.text}
                </span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
