import { useMemo, useState, lazy, Suspense } from "react";
import "./App.css";

const Plot = lazy(() => import("react-plotly.js"));

/* ====================== CONSTANTS ====================== */

const AXES = [
  { key: "roll", label: "Roll", color: "#ef4444" },
  { key: "pitch", label: "Pitch", color: "#22c55e" },
  { key: "yaw", label: "Yaw", color: "#3b82f6" },
];

const PID_TERMS = [
  { key: "P", field: "pidP", dash: "dot" },
  { key: "I", field: "pidI", dash: "dash" },
  { key: "D", field: "pidD", dash: "dashdot" },
  { key: "FF", field: "pidFF", dash: "longdash" },
];

/* ====================== HELPERS ====================== */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

const norm = (h) => String(h ?? "").trim();
const lower = (arr) => arr.map((h) => norm(h).toLowerCase());

function pickFirst(headers, candidates) {
  const l = lower(headers);
  for (const c of candidates) {
    const i = l.indexOf(c.toLowerCase());
    if (i !== -1) return headers[i];
  }
  return "";
}

function pickIncludes(headers, patterns) {
  const l = lower(headers);
  const out = [];
  patterns.forEach((p) => {
    const i = l.findIndex((h) => h.includes(p.toLowerCase()));
    if (i !== -1) out.push(headers[i]);
  });
  return [...new Set(out)];
}

function guessColumns(headers) {
  const time = pickFirst(headers, [
    "time",
    "time_us",
    "time_s",
    "timestamp",
    "loopiteration",
    "looptime",
    "t",
  ]);

  const gyro = pickIncludes(headers, [
    "gyro_roll",
    "gyro_pitch",
    "gyro_yaw",
    "gyro[0]",
    "gyro[1]",
    "gyro[2]",
    "gyroadc[0]",
    "gyroadc[1]",
    "gyroadc[2]",
  ]).slice(0, 3);

  const setpoint = pickIncludes(headers, [
    "setpoint_roll",
    "setpoint_pitch",
    "setpoint_yaw",
    "setpoint[0]",
    "setpoint[1]",
    "setpoint[2]",
    "rccommand[0]",
    "rccommand[1]",
    "rccommand[2]",
  ]).slice(0, 3);

  const pid = {};
  PID_TERMS.forEach((t) => {
    pid[t.key] = pickIncludes(headers, [
      `${t.field}[0]`,
      `${t.field}[1]`,
      `${t.field}[2]`,
      `${t.field.toLowerCase()}_roll`,
      `${t.field.toLowerCase()}_pitch`,
      `${t.field.toLowerCase()}_yaw`,
    ]).slice(0, 3);
  });

  return { time, gyro, setpoint, pid };
}

function downsampleXY(x, y, max = 20000) {
  const n = Math.min(x.length, y.length);
  if (n <= max) return { x: x.slice(0, n), y: y.slice(0, n) };
  const step = Math.ceil(n / max);
  const xs = [], ys = [];
  for (let i = 0; i < n; i += step) {
    xs.push(x[i]);
    ys.push(y[i]);
  }
  return { x: xs, y: ys };
}

function rms(arr) {
  const v = arr.filter(isNum);
  if (!v.length) return 0;
  return Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
}

/* ====================== METRICS ====================== */

function stepResponseMetrics(t, sp, gy) {
  const n = Math.min(t.length, sp.length, gy.length);
  if (n < 50) return null;

  const delta = [];
  for (let i = 1; i < n; i++) delta.push(sp[i] - sp[i - 1]);
  const stepIdx = delta
    .map((v, i) => (Math.abs(v) > 5 ? i + 1 : null))
    .filter((v) => v !== null)
    .slice(0, 3);

  if (!stepIdx.length) return { steps: 0 };

  let overs = [], settles = [], sse = [];

  stepIdx.forEach((idx) => {
    const target = sp[idx];
    const seg = gy.slice(idx, idx + 200);
    const peak = Math.max(...seg);
    overs.push(Math.max(0, ((peak - target) / Math.abs(target)) * 100));

    let settled = null;
    for (let i = 0; i < seg.length; i++) {
      if (Math.abs(seg[i] - target) < Math.abs(target) * 0.05) {
        settled = i;
        break;
      }
    }
    if (settled != null) settles.push(settled * 1);

    const tail = seg.slice(-20);
    sse.push(tail.reduce((a, b) => a + b, 0) / tail.length - target);
  });

  return {
    steps: stepIdx.length,
    overshoot_pct: overs.reduce((a, b) => a + b, 0) / overs.length,
    settle_ms: settles.length ? settles.reduce((a, b) => a + b) / settles.length : null,
    sse: sse.reduce((a, b) => a + b, 0) / sse.length,
  };
}

/* ====================== WARNINGS ====================== */

function generateWarnings(m) {
  const w = [];
  if (m.overshoot_pct > 20)
    w.push({ level: "error", code: "P_HIGH", text: "High overshoot → P too high" });
  if (m.settle_ms > 350)
    w.push({ level: "warn", code: "D_LOW", text: "Slow settling → D too low" });
  if (m.noise_rms > 15)
    w.push({ level: "warn", code: "D_NOISE", text: "High noise → D too high / filtering" });
  if (Math.abs(m.sse) > 2)
    w.push({ level: "info", code: "I_WINDUP", text: "Steady‑state error → I windup" });
  return w;
}

/* ====================== RECOMMENDATIONS ====================== */

function generateRecommendations(m, ws) {
  let p = 1, i = 1, d = 1, ff = 1;
  const r = [];

  const has = (c) => ws.some((w) => w.code === c);

  if (has("P_HIGH")) { p *= 0.9; r.push("Reduce P ~10%"); }
  if (has("D_LOW"))  { d *= 1.1; r.push("Increase D ~10%"); }
  if (has("D_NOISE")){ d *= 0.9; r.push("Reduce D ~10% / add filtering"); }
  if (has("I_WINDUP")){ i *= 0.95; r.push("Reduce I slightly"); }

  return { p, i, d, ff, reasons: r.length ? r : ["No changes suggested"] };
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

/* ====================== APP ====================== */

export default function App() {
  const [fileInfo, setFileInfo] = useState(null);
  const [timeCol, setTimeCol] = useState("");
  const [gyroCols, setGyroCols] = useState([]);
  const [setCols, setSetCols] = useState([]);
  const [pidCols, setPidCols] = useState({});
  const [pidOn, setPidOn] = useState({ P: true, I: true, D: true, FF: false });

  function loadCSV(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const lines = String(r.result).split(/\r?\n/).filter(Boolean);
      const headers = lines[0].split(",").map(norm);
      const rows = lines.slice(1).map((l) => {
        const v = l.split(",");
        const o = {};
        headers.forEach((h, i) => {
          const n = Number(v[i]);
          o[h] = Number.isFinite(n) ? n : null;
        });
        return o;
      });
      const g = guessColumns(headers);
      setFileInfo({ rows, headers });
      setTimeCol(g.time);
      setGyroCols(g.gyro);
      setSetCols(g.setpoint);
      setPidCols(g.pid);
    };
    r.readAsText(f);
  }

  const analysis = useMemo(() => {
    if (!fileInfo || !timeCol) return null;
    const t = fileInfo.rows.map((r) => r[timeCol]).filter(isNum);
    const out = {};
    AXES.forEach((a, i) => {
      const gy = fileInfo.rows.map((r) => r[gyroCols[i]]).filter(isNum);
      const sp = fileInfo.rows.map((r) => r[setCols[i]]).filter(isNum);
      if (!gy.length || !sp.length) return;
      const m = stepResponseMetrics(t, sp, gy);
      m.noise_rms = rms(gy.filter((_, i) => Math.abs(sp[i]) < 5));
      const ws = generateWarnings(m);
      out[a.key] = {
        m,
        ws,
        rec: generateRecommendations(m, ws),
        score: computeTuneScore(m),
      };
    });
    return out;
  }, [fileInfo, timeCol, gyroCols, setCols]);

  return (
    <div className="app">
      <h1>iNav PID Analyzer</h1>
      <input type="file" accept=".csv" onChange={loadCSV} />

      {analysis &&
        AXES.map((a) => {
          const p = analysis[a.key];
          if (!p) return null;
          return (
            <div key={a.key} style={{ marginTop: 20 }}>
              <strong style={{ color: a.color }}>
                {a.label} — Score: {p.score}/100
              </strong>
              <ul>
                {p.ws.length
                  ? p.ws.map((w, i) => <li key={i}>{w.text}</li>)
                  : <li>✅ No issues</li>}
              </ul>
              <div>
                <b>Suggested:</b> P {((p.rec.p - 1) * 100).toFixed(0)}% ·
                I {((p.rec.i - 1) * 100).toFixed(0)}% ·
                D {((p.rec.d - 1) * 100).toFixed(0)}%
              </div>
            </div>
          );
        })}
    </div>
  );
}
