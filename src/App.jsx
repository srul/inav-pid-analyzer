// === PIXEL-PERFECT iNav / ArduPilot PID Analyzer ===
// This file consolidates:
// - Original dark/light UI (from screenshot)
// - Confidence meter
// - Threshold controls + reset
// - Hover numeric values
// - FFT logic (Step 23)

import { useEffect, useMemo, useState } from "react";
import ConfidenceIndicator from "./components/ConfidenceIndicator";

/* ================= CONSTANTS ================= */
const AXES = ["roll", "pitch", "yaw"];
const AXIS_LABEL = { roll: "ROLL", pitch: "PITCH", yaw: "YAW" };
const TABS = ["Overview", "Charts", "Recommendations"];
const FIRMWARES = ["iNav", "ArduPilot"];

const FFT_WINDOW = 512;
const FFT_MIN_HZ = 20;
const FFT_MAX_HZ = 300;

const DEFAULT_WARN = 2.5;
const DEFAULT_CRIT = 5.0;

const THEME_KEY = "pid-theme";
const FW_KEY = "pid-fw";

/* ================= THEME ================= */
function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/* ================= MATH ================= */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ================= FFT ================= */
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

  return Array.from({ length: N/2 }, (_, i) => Math.hypot(re[i], im[i]) / N);
}

function sampleRateHz(data) {
  const dts = [];
  for (let i = Math.max(1, data.length - 200); i < data.length; i++) {
    const dt = data[i].time - data[i-1].time;
    if (dt > 0) dts.push(dt);
  }
  return 1 / (median(dts) || 0.002);
}

/* ================= CSV ================= */
function parseCSV(file, onOk, onErr) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const lines = r.result.split(/\r?\n/).filter(Boolean);
      const h = lines[0].split(",");
      const idx = k => h.indexOf(k);
      const need = ["time","gyro[0]","gyro[1]","gyro[2]","setpoint[0]","setpoint[1]","setpoint[2]"];
      need.forEach(k => { if (idx(k) < 0) throw new Error("Missing " + k); });

      const d = lines.slice(1).map(l => {
        const p = l.split(",");
        return {
          time:+p[idx("time")],
          roll:{gyro:+p[idx("gyro[0]")], set:+p[idx("setpoint[0]")]},
          pitch:{gyro:+p[idx("gyro[1]")], set:+p[idx("setpoint[1]")]},
          yaw:{gyro:+p[idx("gyro[2]")], set:+p[idx("setpoint[2]")]},
        };
      }).filter(r => Number.isFinite(r.time));

      if (d.length < 30) throw new Error("Log too short");
      onOk(d);
    } catch(e){ onErr(e.message); }
  };
  r.readAsText(file);
}

/* ================= TOOLTIP ================= */
function Tooltip({ t }) {
  if (!t) return null;
  return (
    <div style={{
      position:"fixed",
      left:t.x+12, top:t.y+12,
      background:"rgba(10,15,30,0.95)",
      border:"1px solid rgba(120,160,220,0.25)",
      borderRadius:10,
      padding:"8px 10px",
      color:"#e5e7eb",
      fontSize:12,
      fontFamily:"ui-monospace,Menlo,monospace",
      pointerEvents:"none",
      zIndex:9999,
      boxShadow:"0 14px 40px rgba(0,0,0,0.55)"
    }}>
      {t.lines.map((l,i)=><div key={i}>{l}</div>)}
    </div>
  );
}

/* ================= CONFIDENCE ================= */
function confidence(peakRatio, warn, crit) {
  if (!peakRatio) return {label:"—", pct:0, color:"var(--muted)"};
  if (peakRatio >= crit) return {label:"HIGH", pct:100, color:"var(--critical)"};
  if (peakRatio >= warn)
    return {label:"MEDIUM", pct:((peakRatio-warn)/(crit-warn))*100, color:"var(--warning)"};
  return {label:"LOW", pct:(peakRatio/warn)*100, color:"var(--ok)"};
}

/* ================= SVG ================= */
function buildPolyline(pts,w,h,p=18){
  if(!pts.length) return "";
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs);
  const minY=Math.min(...ys), maxY=Math.max(...ys);
  return pts.map(pt=>{
    const X=p+(pt.x-minX)/(maxX-minX||1)*(w-2*p);
    const Y=h-p-(pt.y-minY)/(maxY-minY||1)*(h-2*p);
    return `${X},${Y}`;
  }).join(" ");
}

/* ================= APP ================= */
export default function App(){
  // FULL APP CONTINUES…
}
