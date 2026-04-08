import { useEffect, useMemo, useState } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];
const FIRMWARES = ["ArduPilot", "iNav"];

const FFT_WINDOW = 512;
const FFT_MIN_HZ = 20;
const FFT_MAX_HZ = 300;

// Default thresholds
const DEFAULT_VIB_WARN_RATIO = 2.5;
const DEFAULT_VIB_CRIT_RATIO = 5.0;

/* ================= PARAM MAP (kept minimal here) ================= */
const PARAMS = {
  ArduPilot: {
    notchEnable: "INS_HNTCH_ENABLE",
    notchFreq: "INS_HNTCH_FREQ",
    notchBW: "INS_HNTCH_BW",
    rateP: (a) =>
      a === "roll" ? "ATC_RAT_RLL_P" :
      a === "pitch" ? "ATC_RAT_PIT_P" :
      "ATC_RAT_YAW_P",
  },
  iNav: {
    notchEnable: "gyro_notch1_enabled",
    notchFreq: "gyro_notch1_hz",
    notchBW: "gyro_notch1_cutoff",
    rateP: (a) => `${a}_p`,
  },
};

/* ================= NUM HELPERS ================= */
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function hann(N) {
  return Array.from({ length: N }, (_, i) =>
    0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)))
  );
}

/* ================= FFT (simple radix-2) ================= */
function fftMagReal(sig) {
  const N = sig.length;
  const re = sig.slice();
  const im = Array(N).fill(0);

  // bit reversal
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j |= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }

  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k);
        const tr = c * re[i + k + len/2] - s * im[i + k + len/2];
        const ti = s * re[i + k + len/2] + c * im[i + k + len/2];
        re[i + k + len/2] = re[i + k] - tr;
        im[i + k + len/2] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
      }
    }
  }

  // half spectrum magnitude
  return Array.from({ length: N/2 }, (_, i) => Math.hypot(re[i], im[i]) / N);
}

function sampleRate(data) {
  const dts = [];
  for (let i = Math.max(1, data.length - 200); i < data.length; i++) {
    const dt = data[i].time - data[i - 1].time;
    if (dt > 0 && Number.isFinite(dt)) dts.push(dt);
  }
  return 1 / (median(dts) || 0.002);
}

/* ================= CSV LOADER ================= */
function loadCSVFile(file, setRaw, setFs, setErr) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const lines = String(r.result).split(/\r?\n/).filter(Boolean);
      const h = lines[0].split(",");
      const idx = (k) => h.indexOf(k);

      const ti = idx("time");
      if (ti < 0) throw new Error("Missing time column");

      const need = ["gyro[0]","gyro[1]","gyro[2]","setpoint[0]","setpoint[1]","setpoint[2]"];
      need.forEach(k => {
        if (idx(k) < 0) throw new Error(`Missing column: ${k}`);
      });

      const d = lines.slice(1).map((x) => {
        const p = x.split(",");
        return {
          time: +p[ti],
          roll: { gyro: +p[idx("gyro[0]")], set: +p[idx("setpoint[0]")] },
          pitch:{ gyro: +p[idx("gyro[1]")], set: +p[idx("setpoint[1]")] },
          yaw:  { gyro: +p[idx("gyro[2]")], set: +p[idx("setpoint[2]")] },
        };
      }).filter(r => Number.isFinite(r.time));

      if (d.length < 20) throw new Error("Not enough rows");

      setErr("");
      setRaw(d);
      setFs(sampleRate(d));
    } catch (e) {
      setErr(e.message || String(e));
      setRaw(null);
      setFs(null);
    }
  };
  r.readAsText(file);
}

/* ================= TOOLTIP ================= */
function Tooltip({ t }) {
  if (!t) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: t.x + 12,
        top: t.y + 12,
        background: "rgba(15,23,42,0.95)",
        color: "#e5e7eb",
        border: "1px solid rgba(148,163,184,0.35)",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.35,
        fontFamily: "ui-monospace, Menlo, monospace",
        pointerEvents: "none",
        zIndex: 9999
      }}
    >
      {t.lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

/* ================= SVG HELPERS ================= */
function buildPolyline(pts, w, h, pad=12) {
  if (!pts.length) return "";
  const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs);
  const minY=Math.min(...ys), maxY=Math.max(...ys);
  const dx = (maxX-minX) || 1;
  const dy = (maxY-minY) || 1;

  return pts.map(p=>{
    const X = pad + (p.x-minX)/dx*(w-2*pad);
    const Y = h-pad - (p.y-minY)/dy*(h-2*pad);
    return `${X.toFixed(1)},${Y.toFixed(1)}`;
  }).join(" ");
}

const downsample = (a, n) =>
  a.length <= n ? a : a.filter((_, i) => i % Math.ceil(a.length/n) === 0);

/* ================= CONFIDENCE METER ================= */
function confidenceLevel(peakRatio, warnR, critR) {
  if (peakRatio == null || !Number.isFinite(peakRatio)) return { label: "—", color: "#64748b", pct: 0 };
  if (peakRatio >= critR) return { label: "HIGH", color: "#ef4444", pct: 100 };
  if (peakRatio >= warnR) {
    const pct = clamp(((peakRatio - warnR) / (critR - warnR)) * 100, 1, 99);
    return { label: "MEDIUM", color: "#f59e0b", pct };
  }
  const pct = clamp((peakRatio / warnR) * 100, 1, 80);
  return { label: "LOW", color: "#22c55e", pct };
}

/* ================= APP ================= */
export default function App() {
  const [fw, setFw] = useState("ArduPilot");
  const [axis, setAxis] = useState("roll");
  const [raw, setRaw] = useState(null);
  const [fs, setFs] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [err, setErr] = useState("");

  const [warnR, setWarnR] = useState(DEFAULT_VIB_WARN_RATIO);
  const [critR, setCritR] = useState(DEFAULT_VIB_CRIT_RATIO);

  const P = PARAMS[fw];

  const chartData = useMemo(() => {
    if (!raw) return null;
    return downsample(
      raw.map(r => ({ t: r.time, gyro: r[axis].gyro, set: r[axis].set })),
      260
    );
  }, [raw, axis]);

  const spectrum = useMemo(() => {
    if (!raw || !fs) return null;
    const g = raw.map(r => r[axis].gyro);
    if (g.length < FFT_WINDOW) return null;

    const w = hann(FFT_WINDOW);
    const win = g.slice(-FFT_WINDOW).map((v,i)=>v*w[i]);
    const mags = fftMagReal(win);

    return mags
      .map((m,i)=>({ f: i*fs/FFT_WINDOW, m }))
      .filter(p=>p.f>=FFT_MIN_HZ && p.f<=FFT_MAX_HZ);
  }, [raw, fs, axis]);

  // Compute peakFreq + noiseFloor + peakRatio from spectrum
  const fftSummary = useMemo(() => {
    if (!spectrum || spectrum.length < 10) return null;
    let peak = spectrum[0];
    for (const p of spectrum) if (p.m > peak.m) peak = p;
    const noise = median(spectrum.map(p => p.m));
    const peakRatio = noise > 0 ? peak.m / noise : null;
    return { peakFreq: peak.f, peakMag: peak.m, noise, peakRatio };
  }, [spectrum]);

  const conf = useMemo(() => {
    return confidenceLevel(fftSummary?.peakRatio ?? null, warnR, critR);
  }, [fftSummary, warnR, critR]);

  const resetThresholds = () => {
    setWarnR(DEFAULT_VIB_WARN_RATIO);
    setCritR(DEFAULT_VIB_CRIT_RATIO);
  };

  return (
    <div style={{maxWidth:960, margin:"0 auto", padding:16}}>
      <h2 style={{marginTop:0}}>{fw} PID Analyzer</h2>

      <div style={{display:"flex", gap:10, flexWrap:"wrap", alignItems:"center"}}>
        <input type="file" accept=".csv"
          onChange={e => loadCSVFile(e.target.files[0], setRaw, setFs, setErr)}
        />

        <select value={fw} onChange={e=>setFw(e.target.value)}>
          {FIRMWARES.map(f=><option key={f}>{f}</option>)}
        </select>

        <select value={axis} onChange={e=>setAxis(e.target.value)}>
          {AXES.map(a=><option key={a} value={a}>{a.toUpperCase()}</option>)}
        </select>

        <span style={{opacity:0.8}}>Vib warn ≥</span>
        <input type="number" step="0.1" min="1" max="20"
          value={warnR} onChange={e=>setWarnR(Number(e.target.value))}
          style={{width:90}}
        />
        <span style={{opacity:0.8}}>crit ≥</span>
        <input type="number" step="0.1" min="1" max="20"
          value={critR} onChange={e=>setCritR(Number(e.target.value))}
          style={{width:90}}
        />

        <button onClick={resetThresholds}>
          Reset thresholds
        </button>
      </div>

      {err && <div style={{color:"#ef4444", marginTop:10}}>{err}</div>}

      {/* ===== Confidence meter (based on peakRatio) ===== */}
      <div style={{
        marginTop:12,
        padding:12,
        border:"1px solid #334155",
        borderRadius:10,
        background:"rgba(2,6,23,0.35)"
      }}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline"}}>
          <div style={{fontWeight:700}}>FFT Confidence</div>
          <div style={{fontFamily:"ui-monospace, Menlo, monospace", opacity:0.9}}>
            peakRatio: {fftSummary?.peakRatio ? fftSummary.peakRatio.toFixed(2) + "×" : "—"}
            {fftSummary?.peakFreq ? ` | peak: ${fftSummary.peakFreq.toFixed(1)} Hz` : ""}
          </div>
        </div>

        <div style={{display:"flex", gap:10, alignItems:"center", marginTop:8}}>
          <div style={{
            flex:1,
            height:10,
            borderRadius:999,
            background:"rgba(148,163,184,0.22)",
            overflow:"hidden"
          }}>
            <div style={{
              width: `${conf.pct}%`,
              height:"100%",
              background: conf.color,
              transition:"width 200ms ease"
            }}/>
          </div>
          <div style={{
            fontWeight:800,
            color: conf.color,
            minWidth: 70,
            textAlign:"right"
          }}>
            {conf.label}
          </div>
        </div>

        <div style={{marginTop:6, opacity:0.8, fontSize:12}}>
          LOW &lt; warn ({warnR}×) · MEDIUM {warnR}×–{critR}× · HIGH ≥ {critR}×
        </div>
      </div>

      {/* ===== Charts with hover numeric tooltips ===== */}
      {chartData && (
        <>
          <h3 style={{marginTop:16}}>Time Domain (Gyro vs Setpoint)</h3>
          <svg
            width="920" height="160" viewBox="0 0 920 160"
            style={{border:"1px solid #334155", borderRadius:10, background:"rgba(2,6,23,0.25)"}}
            onMouseLeave={()=>setTooltip(null)}
            onMouseMove={e=>{
              const r=e.currentTarget.getBoundingClientRect();
              const i=Math.round(((e.clientX-r.left)/r.width)*(chartData.length-1));
              const p=chartData[i];
              if(!p) return;
              setTooltip({
                x:e.clientX, y:e.clientY,
                lines:[
                  `Time: ${p.t.toFixed(3)} s`,
                  `Gyro: ${p.gyro.toFixed(2)}`,
                  `Set:  ${p.set.toFixed(2)}`
                ]
              });
            }}
          >
            <polyline
              points={buildPolyline(chartData.map(p=>({x:p.t,y:p.set})),920,160)}
              fill="none" stroke="#f59e0b" strokeDasharray="6 4" strokeWidth="2"
            />
            <polyline
              points={buildPolyline(chartData.map(p=>({x:p.t,y:p.gyro})),920,160)}
              fill="none" stroke="#38bdf8" strokeWidth="2"
            />
          </svg>

          {spectrum && (
            <>
              <h3 style={{marginTop:16}}>Frequency Domain (FFT)</h3>
              <svg
                width="920" height="180" viewBox="0 0 920 180"
                style={{border:"1px solid #334155", borderRadius:10, background:"rgba(2,6,23,0.25)"}}
                onMouseLeave={()=>setTooltip(null)}
                onMouseMove={e=>{
                  const r=e.currentTarget.getBoundingClientRect();
                  const i=Math.round(((e.clientX-r.left)/r.width)*(spectrum.length-1));
                  const p=spectrum[i];
                  if(!p) return;
                  setTooltip({
                    x:e.clientX, y:e.clientY,
                    lines:[
                      `Freq: ${p.f.toFixed(1)} Hz`,
                      `Mag:  ${p.m.toExponential(2)}`
                    ]
                  });
                }}
              >
                <polyline
                  points={buildPolyline(downsample(spectrum,240).map(p=>({x:p.f,y:p.m})),920,180)}
                  fill="none" stroke="#38bdf8" strokeWidth="2"
                />
              </svg>
            </>
          )}

          {/* Simple text showing mapped parameters for user visibility */}
          {fftSummary?.peakFreq && (
            <div style={{
              marginTop:14,
              padding:12,
              border:"1px solid #334155",
              borderRadius:10
            }}>
              <div style={{fontWeight:800}}>Suggested Notch (FFT peak-based)</div>
              <div style={{fontFamily:"ui-monospace, Menlo, monospace", marginTop:6}}>
                {P.notchEnable} = 1<br/>
                {P.notchFreq} = {Math.round(fftSummary.peakFreq)} Hz<br/>
                {P.notchBW} = {Math.round(clamp(fftSummary.peakFreq * 0.5, 30, 140))} Hz<br/>
                {P.rateP(axis)} → Reduce 5–10% (if overshoot present)
              </div>
            </div>
          )}
        </>
      )}

      <Tooltip t={tooltip}/>
    </div>
  );
}
