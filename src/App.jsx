import { useMemo, useState } from "react";
import "./App.css";

/* ====================== CONSTANTS ====================== */

const AXES = [
  { key: "roll", label: "Roll", color: "#ef4444" },
  { key: "pitch", label: "Pitch", color: "#22c55e" },
  { key: "yaw", label: "Yaw", color: "#3b82f6" },
];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/* ====================== HELPERS ====================== */

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
  return {
    time: pickFirst(headers, ["time", "time_us", "timestamp", "t"]),
    gyro: pickIncludes(headers, ["gyro[0]", "gyro[1]", "gyro[2]", "gyro_roll"]).slice(0, 3),
    set: pickIncludes(headers, ["setpoint[0]", "setpoint[1]", "setpoint[2]", "rccommand"]).slice(0, 3),
  };
}

/* ====================== METRICS ====================== */

function rms(arr) {
  const v = arr.filter(isNum);
  if (!v.length) return 0;
  return Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
}

function stepResponseMetrics(sp, gy) {
  const n = Math.min(sp.length, gy.length);
  if (n < 50) return null;

  const stepIdx = [];
  for (let i = 1; i < n; i++) {
    if (Math.abs(sp[i] - sp[i - 1]) > 5) stepIdx.push(i);
  }
  if (!stepIdx.length) return { steps: 0 };

  const overs = [];
  const settles = [];
  const sse = [];

  stepIdx.slice(0, 3).forEach((idx) => {
    const target = sp[idx];
    const seg = gy.slice(idx, idx + 200);
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

/* ====================== SCORING / WARNINGS ====================== */

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

function analyzeCSV(fileInfo) {
  if (!fileInfo) return null;

  const { rows, cols } = fileInfo;
  const out = {};

  AXES.forEach((a, i) => {
    const gy = rows.map((r) => r[cols.gyro[i]]).filter(isNum);
    const sp = rows.map((r) => r[cols.set[i]]).filter(isNum);
    if (!gy.length || !sp.length) return;

    const m = stepResponseMetrics(sp, gy);
    if (!m) return;

    m.noise_rms = rms(gy.filter((_, i) => Math.abs(sp[i] ?? 0) < 5));
    const score = computeTuneScore(m);

    out[a.key] = { ...m, score };
  });

  return out;
}

/* ====================== APP ====================== */

export default function App() {
  const [baseline, setBaseline] = useState(null);
  const [candidate, setCandidate] = useState(null);

  function loadFile(e, setter) {
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

      setter({ rows, headers, cols: guessColumns(headers), name: f.name });
    };
    r.readAsText(f);
  }

  const before = useMemo(() => analyzeCSV(baseline), [baseline]);
  const after = useMemo(() => analyzeCSV(candidate), [candidate]);

  return (
    <div className="app">
      <h1>iNav PID Analyzer — Compare</h1>

      <div style={{ display: "flex", gap: 20 }}>
        <div>
          <h3>Baseline</h3>
          <input type="file" accept=".csv" onChange={(e) => loadFile(e, setBaseline)} />
          <div>{baseline?.name}</div>
        </div>
        <div>
          <h3>Candidate</h3>
          <input type="file" accept=".csv" onChange={(e) => loadFile(e, setCandidate)} />
          <div>{candidate?.name}</div>
        </div>
      </div>

      {before && after && (
        <table style={{ marginTop: 30, width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Axis</th>
              <th>Score</th>
              <th>Δ Score</th>
              <th>Overshoot %</th>
              <th>Settling</th>
              <th>Noise</th>
            </tr>
          </thead>
          <tbody>
            {AXES.map((a) => {
              const b = before[a.key];
              const c = after[a.key];
              if (!b || !c) return null;

              const dScore = c.score - b.score;

              return (
                <tr key={a.key} style={{ borderTop: "1px solid #ddd" }}>
                  <td><b>{a.label}</b></td>
                  <td>{b.score} → {c.score}</td>
                  <td style={{ color: dScore >= 0 ? "green" : "red" }}>
                    {dScore >= 0 ? "+" : ""}{dScore}
                  </td>
                  <td>{b.overshoot_pct.toFixed(1)} → {c.overshoot_pct.toFixed(1)}</td>
                  <td>{b.settle_ms?.toFixed(0) ?? "–"} → {c.settle_ms?.toFixed(0) ?? "–"}</td>
                  <td>{b.noise_rms.toFixed(2)} → {c.noise_rms.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
