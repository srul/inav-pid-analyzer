import { useMemo, useState, lazy, Suspense } from "react";
import "./App.css";

const Plot = lazy(() => import("react-plotly.js"));

/* ---------- helpers ---------- */

const AXES = [
  { key: "roll",  label: "Roll",  color: "#ef4444" },
  { key: "pitch", label: "Pitch", color: "#22c55e" },
  { key: "yaw",   label: "Yaw",   color: "#3b82f6" },
];

function norm(h) {
  return String(h ?? "").trim();
}
function lower(headers) {
  return headers.map(h => norm(h).toLowerCase());
}

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
  patterns.forEach(p => {
    const i = l.findIndex(h => h.includes(p));
    if (i !== -1) out.push(headers[i]);
  });
  return [...new Set(out)];
}

function guessColumns(headers) {
  const time = pickFirst(headers, [
    "time", "time_s", "time_us", "timestamp",
    "loopiteration", "looptime", "t",
  ]);

  const gyro = pickIncludes(headers, [
    "gyro_roll", "gyro_pitch", "gyro_yaw",
    "gyroadc[0]", "gyroadc[1]", "gyroadc[2]",
    "gyro[0]", "gyro[1]", "gyro[2]",
  ]).slice(0, 3);

  const setpoint = pickIncludes(headers, [
    "setpoint_roll", "setpoint_pitch", "setpoint_yaw",
    "setpoint[0]", "setpoint[1]", "setpoint[2]",
    "rccommand[0]", "rccommand[1]", "rccommand[2]",
  ]).slice(0, 3);

  return { time, gyro, setpoint };
}

function downsample(x, y, max = 20000) {
  const n = Math.min(x.length, y.length);
  if (n <= max) return { x: x.slice(0,n), y: y.slice(0,n) };
  const step = Math.ceil(n / max);
  const xs = [], ys = [];
  for (let i=0; i<n; i+=step) { xs.push(x[i]); ys.push(y[i]); }
  if (xs[xs.length-1] !== x[n-1]) { xs.push(x[n-1]); ys.push(y[n-1]); }
  return { x: xs, y: ys };
}

/* ---------- metrics ---------- */

function rms(arr) {
  const v = arr.filter(n => Number.isFinite(n));
  if (!v.length) return 0;
  return Math.sqrt(v.reduce((a,b)=>a+b*b,0)/v.length);
}

function overshoot(setp, meas) {
  if (!setp.length || !meas.length) return 0;
  const sp = Math.max(...setp.map(Math.abs));
  if (!sp) return 0;
  const ov = Math.max(...meas.map(Math.abs)) - sp;
  return Math.max(0, (ov / sp) * 100);
}

/* ---------- component ---------- */

export default function App() {
  const [fileInfo, setFileInfo] = useState(null);
  const [timeCol, setTimeCol] = useState("");
  const [gyroCols, setGyroCols] = useState([]);
  const [setpointCols, setSetpointCols] = useState([]);
  const [axesOn, setAxesOn] = useState({ roll:true, pitch:true, yaw:true });
  const [maxPoints, setMaxPoints] = useState(20000);
  const [showSetpoint, setShowSetpoint] = useState(true);

  function loadFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const lines = String(r.result).split(/\r?\n/).filter(Boolean);
      const headers = lines[0].split(",").map(norm);
      const rows = lines.slice(1).map(l => {
        const v = l.split(",");
        const o = {};
        headers.forEach((h,i)=> {
          const n = Number(v[i]);
          o[h] = Number.isFinite(n) ? n : v[i];
        });
        return o;
      });
      const g = guessColumns(headers);
      setFileInfo({ headers, rows });
      setTimeCol(g.time); setGyroCols(g.gyro); setSetpointCols(g.setpoint);
      setShowSetpoint(g.setpoint.length>0);
    };
    r.readAsText(f);
  }

  const traces = useMemo(() => {
    if (!fileInfo || !timeCol) return [];
    const x = fileInfo.rows.map(r => r[timeCol]).filter(v=>v!=null);
    const out = [];
    AXES.forEach((a,i)=>{
      if (!axesOn[a.key]) return;
      const g = gyroCols[i];
      if (g) {
        const y = fileInfo.rows.map(r=>r[g]);
        const ds = downsample(x, y, maxPoints);
        out.push({
          x: ds.x, y: ds.y,
          name: `${a.label} gyro`,
          mode:"lines", type:"scatter",
          line:{ color:a.color, width:2 }
        });
      }
      if (showSetpoint && setpointCols[i]) {
        const y = fileInfo.rows.map(r=>r[setpointCols[i]]);
        const ds = downsample(x, y, maxPoints);
        out.push({
          x: ds.x, y: ds.y,
          name: `${a.label} setpoint`,
          mode:"lines", type:"scatter",
          line:{ color:a.color, width:2, dash:"dash" }
        });
      }
    });
    return out;
  }, [fileInfo, timeCol, gyroCols, setpointCols, axesOn, maxPoints, showSetpoint]);

  const metrics = useMemo(() => {
    if (!fileInfo) return {};
    const res = {};
    AXES.forEach((a,i)=>{
      const g = gyroCols[i], s = setpointCols[i];
      if (!g || !s) return;
      const gy = fileInfo.rows.map(r=>r[g]);
      const sp = fileInfo.rows.map(r=>r[s]);
      res[a.key] = {
        overshoot: overshoot(sp, gy).toFixed(1),
        noise: rms(gy.filter((_,j)=>Math.abs(sp[j])<5)).toFixed(2),
      };
    });
    return res;
  }, [fileInfo, gyroCols, setpointCols]);

  return (
    <div className="app">
      <header className="header">
        <h1>iNav PID Analyzer</h1>
        <p>Gyro vs Setpoint • Roll / Pitch / Yaw</p>
      </header>

      <main className="main">
        <section className="upload-card">
          <h2>Upload CSV</h2>
          <input type="file" accept=".csv" onChange={loadFile} />
          <div style={{marginTop:12}}>
            {AXES.map(a=>(
              <label key={a.key} style={{marginRight:12}}>
                <input
                  type="checkbox"
                  checked={axesOn[a.key]}
                  onChange={e=>setAxesOn({...axesOn,[a.key]:e.target.checked})}
                /> {a.label}
              </label>
            ))}
          </div>
          <div style={{marginTop:12}}>
            <label>
              <input
                type="checkbox"
                checked={showSetpoint}
                onChange={e=>setShowSetpoint(e.target.checked)}
              /> Show setpoint
            </label>
          </div>
          <div style={{marginTop:12}}>
            Downsample:
            <select value={maxPoints} onChange={e=>setMaxPoints(+e.target.value)}>
              <option value={5000}>5k</option>
              <option value={10000}>10k</option>
              <option value={20000}>20k</option>
              <option value={50000}>50k</option>
            </select>
          </div>
        </section>

        <section className="empty-state">
          {traces.length>0 && (
            <Suspense fallback={<p>Loading chart…</p>}>
              <Plot
                data={traces}
                layout={{
                  title:"Gyro vs Setpoint",
                  legend:{orientation:"h"},
                  margin:{t:40,l:50,r:20,b:40},
                  xaxis:{title:timeCol},
                  yaxis:{title:"Value"},
                }}
                style={{width:"100%",height:520}}
                config={{responsive:true}}
              />
            </Suspense>
          )}

          <div style={{marginTop:16}}>
            {AXES.map(a=>metrics[a.key] && (
              <div key={a.key}>
                <strong>{a.label}</strong> —
                Overshoot: {metrics[a.key].overshoot}% ,
                Noise RMS: {metrics[a.key].noise}
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>Beta • iNav 9.x</span>
      </footer>
    </div>
  );
}
