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

/* ====================== PARSING HELPERS ====================== */

const norm = (s) => String(s ?? "").trim().toLowerCase();

function detectDelimiter(line) {
  if (line.includes(",")) return ",";
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

function guessColumns(headers) {
  const h = headers.map(norm);

  const pick = (names) =>
    names.map((n) => headers[h.indexOf(n)]).find(Boolean) || null;

  return {
    time: pick(["time", "time_us", "timestamp"]) || headers[0],
    gyro: [
      pick(["gyro[0]", "gyro_x"]),
      pick(["gyro[1]", "gyro_y"]),
      pick(["gyro[2]", "gyro_z"]),
    ],
    set: [
      pick(["setpoint[0]", "rccommand[0]"]),
      pick(["setpoint[1]", "rccommand[1]"]),
      pick(["setpoint[2]", "rccommand[2]"]),
    ],
  };
}

/* ====================== NUMERICS ====================== */

function rms(arr) {
  const v = arr.filter(isNum);
  if (!v.length) return 0;
  return Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
}

/* ====================== METRICS ====================== */

function stepResponseMetrics(sp, gy) {
  const n = Math.min(sp.length, gy.length);
  if (n < 100) return null;

  const steps = [];
  for (let i = 1; i < n; i++) {
    if (Math.abs(sp[i] - sp[i - 1]) > 5) steps.push(i);
  }

  if (!steps.length)
    return { overshoot_pct: 0, settle_ms: null, sse: 0 };

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
    settle_ms: settles.length
      ? settles.reduce((a, b) => a + b, 0) / settles.length
      : null,
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

/* ====================== ANALYSIS ====================== */

function analyzeCSV(file) {
  if (!file) return null;

  const { rows, cols } = file;
  const out = {};

  AXES.forEach((a, i) => {
    if (cols.gyro[i] == null || cols.set[i] == null) return;

    const gy = rows.map((r) => r[cols.gyro[i]]).filter(isNum);
    const sp = rows.map((r) => r[cols.set[i]]).filter(isNum);

    if (!gy.length || !sp.length) return;

    const m = stepResponseMetrics(sp, gy);
    if (!m) return;

    m.noise_rms = rms(gy.filter((_, i) => Math.abs(sp[i] ?? 0) < 5));
    m.score = computeTuneScore(m);
    m.gyro = gy;
    m.set = sp;

    out[a.key] = m;
  });

  return out;
}


useEffect(() => {
  if (data) {
    const firstAxis = AXES.find(a => data[a.key]);
    if (firstAxis) setAxis(firstAxis.key);
  }
}, [data]);


/* ====================== APP ====================== */

export default function App() {
  const [file, setFile] = useState(null);
  const [axis, setAxis] = useState("roll");

  function loadFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;

    const r = new FileReader();
    r.onload = () => {
      const text = String(r.result);
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length);

      const delimiter = detectDelimiter(lines[0]);
      const headers = lines[0].split(delimiter);

      const rows = lines.slice(1).map((l) => {
        const v = l.split(delimiter);
        const o = {};
        headers.forEach((h, i) => {
          const n = Number(v[i]);
          o[h] = Number.isFinite(n) ? n : null;
        });
        return o;
      });

      setFile({
        name: f.name,
        headers,
        cols: guessColumns(headers),
        rows,
      });
    };
    r.readAsText(f);
  }

  const data = useMemo(() => analyzeCSV(file), [file]);

  return (
    <div className="app">
      <h1>PID Analyzer — Debug‑Safe Version</h1>

      <input type="file" accept=".csv,.txt" onChange={loadFile} />

      {file && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <b>Loaded:</b> {file.name}
          <pre>
Detected gyro columns: {JSON.stringify(file.cols.gyro)}
Detected setpoint columns: {JSON.stringify(file.cols.set)}
          </pre>
        </div>
      )}

      {!data && file && (
        <div style={{ color: "red", marginTop: 15 }}>
          ⚠ File loaded, but no usable gyro/setpoint columns were found.<br />
          This usually means the log is NOT CSV‑formatted (e.g. ArduPilot TXT).
        </div>
      )}

      {data && (
        <>
          <div style={{ marginTop: 20 }}>
            Axis:&nbsp;
            {AXES.map((a) => (
              <button
                key={a.key}
                onClick={() => setAxis(a.key)}
                style={{ marginRight: 6 }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {!data[axis] && (
            <div style={{ color: "orange", marginTop: 10 }}>
              No data available for {axis.toUpperCase()} axis in this log.
            </div>
          )}

          {data[axis] && (
            <>
              <h3>
                {axis.toUpperCase()} — Score: {data[axis].score}/100
              </h3>

              <Plot
                data={[
                  { y: data[axis].gyro, name: "Gyro", type: "scattergl" },
                  {
                    y: data[axis].set,
                    name: "Setpoint",
                    type: "scattergl",
                    line: { dash: "dash" },
                  },
                ]}
                layout={{ height: 400 }}
                style={{ width: "100%" }}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
