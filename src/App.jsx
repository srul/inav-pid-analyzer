import { useMemo, useState, useEffect } from "react";
import Plot from "react-plotly.js";
import "./App.css";

const AXES = [
  { key: "roll", label: "Roll" },
  { key: "pitch", label: "Pitch" },
  { key: "yaw", label: "Yaw" },
];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const norm = (s) => String(s ?? "").trim();

function detectDelimiter(line) {
  if (line.includes(",")) return ",";
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

function guessColumns(headers) {
  const hLower = headers.map((h) => norm(h).toLowerCase());

  const pick = (names) => {
    for (const n of names) {
      const idx = hLower.indexOf(n.toLowerCase());
      if (idx !== -1) return headers[idx];
    }
    return null;
  };

  return {
    time: pick(["time", "time_us", "timestamp"]) || headers[0] || null,
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

function rms(arr) {
  const v = arr.filter(isNum);
  if (!v.length) return 0;
  return Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
}

function stepResponseMetrics(sp, gy) {
  const n = Math.min(sp.length, gy.length);
  if (n < 50) return null;

  const steps = [];
  for (let i = 1; i < n; i++) {
    if (Math.abs(sp[i] - sp[i - 1]) > 5) steps.push(i);
  }

  if (!steps.length) return { overshoot_pct: 0, settle_ms: null, sse: 0 };

