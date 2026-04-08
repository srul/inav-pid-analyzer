import { useMemo, useState, lazy, Suspense } from "react";
import "./App.css";

const Plot = lazy(() => import("react-plotly.js"));

/* ---------- constants ---------- */

const AXES = [
  { key: "roll",  label: "Roll",  color: "#ef4444" },
  { key: "pitch", label: "Pitch", color: "#22c55e" },
  { key: "yaw",   label: "Yaw",   color: "#3b82f6" },
];

const PID_TERMS = [
  { key: "P", field: "pidP", dash: "dot" },
  { key: "I", field: "pidI", dash: "dash" },
  { key: "D", field: "pidD", dash: "dashdot" },
  { key: "FF", field: "pidFF", dash: "longdash" },
];

/* ---------- helpers ---------- */

const norm = (h) => String(h ?? "").trim();
const lower = (headers) => headers.map(h => norm(h).toLowerCase());

function pickFirst(headers, patterns) {
  const l = lower(headers);
  for (const p of patterns) {
    const i = l.indexOf(p.toLowerCase());
    if (i !== -1) return headers[i];
  }
  return "";
}

function pickIncludes(headers, patterns) {
  const l = lower(headers);
  const out = [];
  patterns.forEach(p => {
    const i = l.findIndex(h => h.includes(p.toLowerCase()));
    if (i !== -1) out.push(headers[i]);
  });
  return [...new Set(out)];
}

function guessColumns(headers) {
  const time = pickFirst(headers, [
    "time", "time_us", "time_s", "timestamp",
    "loopiteration", "looptime", "t",
  ]);

  const gyro = pickIncludes(headers, [
    "gyro_roll","gyro_pitch","gyro_yaw",
    "gyroadc[0]","gyroadc[1]","gyroadc[2]",
  ]).slice(0,3);

  const sp = pickIncludes(headers, [
    "setpoint_roll","setpoint_pitch","setpoint_yaw",
    "setpoint[0]","setpoint[1]","setpoint[2]",
    "rccommand[0]","rccommand[1]","rccommand[2]",
  ]).slice(0,3);

  const pid = {};
  PID_TERMS.forEach(term => {
    pid[term.key] = pickIncludes(headers, [
      `${term.field}[0]`,
      `${term.field}[1]`,
      `${term.field}[2]`,
      `${term.field.toLowerCase()}_roll`,
      `${term.field.toLowerCase()}_pitch`,
      `${term.field.toLowerCase()}_yaw`,
    ]).slice(0,3);
  });

  return { time, gyro, sp, pid };
}

function downsample(x, y, max=20000) {
  const n = Math.min(x.length, y.length);
  if (n <= max) return { x: x.slice(0,n), y: y.slice(0,n) };
  const step = Math.ceil(n/max);
  const xs=[], ys=[];
  for (let i=0;i<n;i+=step){ xs.push(x[i]); ys.push(y[i]); }
  return { x: xs, y: ys };
}

/* ---------- component ---------- */

export default function App() {
  const [fileInfo,setFileInfo] = useState(null);
  const [timeCol,setTimeCol] = useState("");
  const [gyroCols,setGyroCols] = useState([]);
  const [spCols,setSpCols] = useState([]);
  const [pidCols,setPidCols] = useState({});
  const [axesOn,setAxesOn] = useState({ roll:true,pitch:true,yaw:true });
  const [pidOn,setPidOn] = useState({ P:true,I:true,D:true,FF:false });
  const [maxPoints,setMaxPoints] = useState(20000);

  function loadCSV(e){
    const f=e.target.files?.[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{
      const lines=String(r.result).split(/\r?\n/).filter(Boolean);
      const headers=lines[0].split(",").map(norm);
      const rows=lines.slice(1).map(l=>{
        const v=l.split(","); const o={};
        headers.forEach((h,i)=>{
          const n=Number(v[i]); o[h]=Number.isFinite(n)?n:v[i];
        }); return o;
      });
      const g=guessColumns(headers);
      setFileInfo({headers,rows});
      setTimeCol(g.time);
      setGyroCols(g.gyro);
      setSpCols(g.sp);
      setPidCols(g.pid);
    };
    r.readAsText(f);
  }

  const traces = useMemo(()=>{
    if(!fileInfo||!timeCol) return [];
    const t=fileInfo.rows.map(r=>r[timeCol]).filter(v=>v!=null);
    const out=[];
    AXES.forEach((a,i)=>{
      if(!axesOn[a.key]) return;

      // Gyro
      if(gyroCols[i]){
        const y=fileInfo.rows.map(r=>r[gyroCols[i]]);
        const ds=downsample(t,y,maxPoints);
        out.push({ x:ds.x,y:ds.y,name:`${a.label} Gyro`,
          type:"scatter",mode:"lines",
          line:{color:a.color,width:2}});
      }

      // Setpoint
      if(spCols[i]){
        const y=fileInfo.rows.map(r=>r[spCols[i]]);
        const ds=downsample(t,y,maxPoints);
        out.push({ x:ds.x,y:ds.y,name:`${a.label} Setpoint`,
          type:"scatter",mode:"lines",
          line:{color:a.color,width:2,dash:"dash"}});
      }

      // PID terms
      PID_TERMS.forEach(term=>{
        if(!pidOn[term.key]) return;
        const c=pidCols?.[term.key]?.[i];
        if(!c) return;
        const y=fileInfo.rows.map(r=>r[c]);
        const ds=downsample(t,y,maxPoints);
        out.push({
          x:ds.x,y:ds.y,
          name:`${a.label} ${term.key}`,
          type:"scatter",mode:"lines",
          line:{color:a.color,width:1,dash:term.dash},
          opacity:0.6
        });
      });
    });
    return out;
  },[fileInfo,timeCol,gyroCols,spCols,pidCols,axesOn,pidOn,maxPoints]);

  return (
    <div className="app">
      <header className="header">
        <h1>iNav PID Analyzer</h1>
        <p>Gyro + Setpoint + PID P/I/D overlays</p>
      </header>

      <main className="main">
        <section className="upload-card">
          <input type="file" accept=".csv" onChange={loadCSV} />
          <div style={{marginTop:8}}>
            {AXES.map(a=>(
              <label key={a.key} style={{marginRight:10}}>
                <input type="checkbox" checked={axesOn[a.key]}
                  onChange={e=>setAxesOn({...axesOn,[a.key]:e.target.checked})}/>
                {a.label}
              </label>
            ))}
          </div>
          <div style={{marginTop:8}}>
            {PID_TERMS.map(p=>(
              <label key={p.key} style={{marginRight:10}}>
                <input type="checkbox" checked={pidOn[p.key]}
                  onChange={e=>setPidOn({...pidOn,[p.key]:e.target.checked})}/>
                {p.key}
              </label>
            ))}
          </div>
        </section>

        <section className="empty-state">
          {traces.length>0 &&
            <Suspense fallback={<p>Loading plot…</p>}>
              <Plot data={traces}
                layout={{legend:{orientation:"h"},
                  xaxis:{title:timeCol},
                  yaxis:{title:"Value"},
                  margin:{t:40,l:50,r:20,b:40}}}
                style={{width:"100%",height:520}}
                config={{responsive:true}}/>
            </Suspense>}
        </section>
      </main>
    </div>
  );
}
