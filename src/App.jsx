import { useEffect, useMemo, useState } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];
const AXIS_LABEL = { roll: "Roll", pitch: "Pitch", yaw: "Yaw" };
const FIRMWARES = ["ArduPilot", "iNav"];

const THEME_KEY = "pid-theme";
const FW_KEY = "pid-fw";

const FFT_WINDOW = 512;
const FFT_MIN_HZ = 20;
const FFT_MAX_HZ = 300;

// Step 23 thresholds (editable in UI)
const DEFAULT_VIB_WARN_RATIO = 2.5;
const DEFAULT_VIB_CRIT_RATIO = 5.0;

/* ================= PARAM MAP ================= */
const PARAMS = {
  ArduPilot: {
    notchEnable: "INS_HNTCH_ENABLE",
    notchMode: "INS_HNTCH_MODE",
    notchFreq: "INS_HNTCH_FREQ",
    notchBW: "INS_HNTCH_BW",
    notchAtt: "INS_HNTCH_ATT",
    notchHmncs: "INS_HNTCH_HMNCS",
    rateP: (a) =>
      a === "roll" ? "ATC_RAT_RLL_P" :
      a === "pitch" ? "ATC_RAT_PIT_P" :
      "ATC_RAT_YAW_P",
  },
  iNav: {
    notchEnable: "gyro_notch1_enabled",
    notchMode: "gyro_notch1_mode",
    notchFreq: "gyro_notch1_hz",
    notchBW: "gyro_notch1_cutoff",
    notchAtt: "gyro_notch1_att",
    notchHmncs: "gyro_notch1_harmonics",
    rateP: (a) => `${a}_p`,
  },
};

/* ================= HELPERS ================= */
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

function fftMagReal(sig) {
  const N = sig.length;
  const re = sig.slice();
  const im = Array(N).fill(0);

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
        re[i + k] += tr; im[i + k] += ti;
      }
    }
  }

  return Array.from({ length: N/2 }, (_, i) =>
    Math.hypot(re[i], im[i]) / N
  );
}

function sampleRate(data) {
  const dts = [];
  for (let i = Math.max(1, data.length - 200); i < data.length; i++)
    dts.push(data[i].time - data[i-1].time);
  return 1 / (median(dts) || 0.002);
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
  return pts.map(p=>{
    const X = pad + (p.x-minX)/(maxX-minX||1)*(w-2*pad);
    const Y = h-pad - (p.y-minY)/(maxY-minY||1)*(h-2*pad);
    return `${X.toFixed(1)},${Y.toFixed(1)}`;
  }).join(" ");
}

const downsample = (a, n) =>
  a.length <= n ? a : a.filter((_, i) => i % Math.ceil(a.length/n) === 0);

/* ================= APP ================= */
export default function App() {
  const [fw, setFw] = useState(localStorage.getItem(FW_KEY) || "ArduPilot");
  const [axis, setAxis] = useState("roll");
  const [section, setSection] = useState("Charts");

  const [raw, setRaw] = useState(null);
  const [fs, setFs] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  const [warnR, setWarnR] = useState(DEFAULT_VIB_WARN_RATIO);
  const [critR, setCritR] = useState(DEFAULT_VIB_CRIT_RATIO);

  const P = PARAMS[fw];

  const chartData = useMemo(() => {
    if (!raw) return null;
    return downsample(
      raw.map(r => ({
        t: r.time,
        gyro: r[axis].gyro,
        set: r[axis].set
      })),
      250
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

  const loadCSV = (f) => {
    const r = new FileReader();
    r.onload = () => {
      const l = r.result.split(/\r?\n/).filter(Boolean);
      const h = l[0].split(",");
      const idx = k => h.indexOf(k);
      const d = l.slice(1).map(x=>{
        const p=x.split(",");
        return {
          time:+p[idx("time")],
          roll:{gyro:+p[idx("gyro[0]")], set:+p[idx("setpoint[0]")]},
          pitch:{gyro:+p[idx("gyro[1]")], set:+p[idx("setpoint[1]")]},
          yaw:{gyro:+p[idx("gyro[2]")], set:+p[idx("setpoint[2]")]},
        };
      });
      setRaw(d); setFs(sampleRate(d));
    };
    r.readAsText(f);
  };

  return (
    <div style={{maxWidth:960,margin:"0 auto",padding:16}}>
      <h2>{fw} PID Analyzer</h2>

      <input type="file" accept=".csv" onChange={e=>loadCSV(e.target.files[0])}/>
      <select value={fw} onChange={e=>setFw(e.target.value)}>
        {FIRMWARES.map(f=><option key={f}>{f}</option>)}
      </select>

      {section==="Charts" && chartData && (
        <>
          {/* TIME DOMAIN */}
          <svg
            width="920" height="160"
            onMouseLeave={()=>setTooltip(null)}
            onMouseMove={e=>{
              const r=e.currentTarget.getBoundingClientRect();
              const i=Math.round((e.clientX-r.left)/r.width*(chartData.length-1));
              const p=chartData[i];
              if(!p) return;
              setTooltip({
                x:e.clientX,y:e.clientY,
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
              fill="none" stroke="orange" strokeDasharray="6 4"/>
            <polyline
              points={buildPolyline(chartData.map(p=>({x:p.t,y:p.gyro})),920,160)}
              fill="none" stroke="#38bdf8"/>
          </svg>

          {/* FFT */}
          {spectrum && (
            <svg
              width="920" height="180"
              onMouseLeave={()=>setTooltip(null)}
              onMouseMove={e=>{
                const r=e.currentTarget.getBoundingClientRect();
                const i=Math.round((e.clientX-r.left)/r.width*(spectrum.length-1));
                const p=spectrum[i];
                if(!p) return;
                setTooltip({
                  x:e.clientX,y:e.clientY,
                  lines:[
                    `Freq: ${p.f.toFixed(1)} Hz`,
                    `Mag:  ${p.m.toExponential(2)}`
                  ]
                });
              }}
            >
              <polyline
                points={buildPolyline(downsample(spectrum,240).map(p=>({x:p.f,y:p.m})),920,180)}
                fill="none" stroke="#38bdf8"/>
            </svg>
          )}
        </>
      )}

      <Tooltip t={tooltip}/>
    </div>
  );
}
