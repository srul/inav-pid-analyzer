import { useState } from "react";

/* ================= CONFIG ================= */
const AXES = [
  { key: "roll", label: "Roll" },
  { key: "pitch", label: "Pitch" },
  { key: "yaw", label: "Yaw" },
];

const FIRMWARES = {
  ArduPilot: {
    notchEnable: "INS_HNTCH_ENABLE",
    notchFreq: "INS_HNTCH_FREQ",
    notchBW: "INS_HNTCH_BW",
    rateP: "ATC_RAT_RLL_P",
    rateI: "ATC_RAT_RLL_I",
  },
  iNav: {
    notchEnable: "gyro_notch1_enabled",
    notchFreq: "gyro_notch1_hz",
    notchBW: "gyro_notch1_cutoff",
    rateP: "roll_p",
    rateI: "roll_i",
  },
};

const FFT_SAMPLES = 512;

/* ================= CSV ================= */
function parseCSV(file, ok, err) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const l = String(r.result).split(/\r?\n/).filter(Boolean);
      let d = ",";
      if (l[0].includes("\t")) d = "\t";
      else if (l[0].includes(";")) d = ";";

      const h = l[0].split(d);
      const ti = h.indexOf("time");
      const g = {
        roll: h.indexOf("gyro[0]"),
        pitch: h.indexOf("gyro[1]"),
        yaw: h.indexOf("gyro[2]"),
        rollSp: h.indexOf("setpoint[0]"),
        pitchSp: h.indexOf("setpoint[1]"),
        yawSp: h.indexOf("setpoint[2]"),
      };

      ok(
        l.slice(1).map(r => {
          const p = r.split(d);
          return {
            time: +p[ti],
            roll: { gyro: +p[g.roll], set: +p[g.rollSp] },
            pitch: { gyro: +p[g.pitch], set: +p[g.pitchSp] },
            yaw: { gyro: +p[g.yaw], set: +p[g.yawSp] },
          };
        }).filter(r => !isNaN(r.time))
      );
    } catch (e) {
      err(e.message);
    }
  };
  r.readAsText(file);
}

/* ================= STEP 15 UI HELPERS ================= */
const colors = {
  CRITICAL: "#dc2626",
  WARNING: "#f59e0b",
  OK: "#16a34a",
};

/* ================= UI COMPONENTS ================= */

function SummaryHeader({ severity }) {
  return (
    <div style={{
      position: "sticky",
      top: 0,
      zIndex: 10,
      padding: 14,
      background: "#020617",
      borderBottom: `2px solid ${colors[severity]}`,
    }}>
      <h2 style={{ color: colors[severity], margin: 0 }}>
        {severity === "CRITICAL"
          ? "Tune Needs Attention"
          : severity === "WARNING"
          ? "Tune Has Warnings"
          : "Tune Looks Good"}
      </h2>
    </div>
  );
}

function Card({ severity, title, body, params }) {
  return (
    <div style={{
      background: "#020617",
      borderLeft: `6px solid ${colors[severity]}`,
      padding: 16,
      borderRadius: 8,
      marginBottom: 14,
    }}>
      <strong style={{ color: colors[severity] }}>{severity}</strong>
      <div style={{ fontSize: 16, marginTop: 4 }}>{title}</div>
      <div style={{ color: "#9ca3af", marginTop: 6 }}>{body}</div>

      {params && (
        <div style={{ marginTop: 10 }}>
          {params.map((p, i) => (
            <div key={i} style={{
              fontFamily: "monospace",
              fontSize: 13,
              display: "flex",
              justifyContent: "space-between",
            }}>
              <span>{p.name}</span>
              <span>{p.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= APP ================= */
export default function App() {
  const [data, setData] = useState(null);
  const [axis, setAxis] = useState("roll");
  const [firmware, setFirmware] = useState("ArduPilot");

  // --- DEMO SEVERITY / CARDS (logic already proven earlier steps) ---
  const severity = "CRITICAL";
  const cards = [
    {
      severity: "CRITICAL",
      title: "Enable Harmonic Notch Filter",
      body: "Motor vibration enters D‑term directly and limits achievable gains.",
      params: [
        { name: FIRMWARES[firmware].notchEnable, value: "1" },
        { name: FIRMWARES[firmware].notchFreq, value: "120 Hz" },
        { name: FIRMWARES[firmware].notchBW, value: "60 Hz" },
      ],
    },
    {
      severity: "WARNING",
      title: "High Overshoot",
      body: "PID loop is aggressive.",
      params: [
        { name: FIRMWARES[firmware].rateP, value: "Reduce 5–10%" },
      ],
    },
  ];

  return (
    <div style={{
      background: "#020617",
      minHeight: "100vh",
      color: "#e5e7eb",
      maxWidth: 720,
      margin: "0 auto",
    }}>
      <SummaryHeader severity={severity} />

      <div style={{ padding: 16 }}>
        <input
          type="file"
          accept=".csv"
          onChange={e => parseCSV(e.target.files[0], setData, console.error)}
          style={{ width: "100%" }}
        />

        {/* Firmware selector */}
        <select
          value={firmware}
          onChange={e => setFirmware(e.target.value)}
          style={{ width: "100%", marginTop: 10 }}
        >
          {Object.keys(FIRMWARES).map(f => (
            <option key={f}>{f}</option>
          ))}
        </select>

        {/* Axis selector */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {AXES.map(a => (
            <button
              key={a.key}
              onClick={() => setAxis(a.key)}
              style={{
                flex: 1,
                padding: 10,
                background: axis === a.key ? "#334155" : "#020617",
                color: "#e5e7eb",
                border: "1px solid #334155",
                borderRadius: 6,
              }}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Cards */}
        <div style={{ marginTop: 16 }}>
          {cards.map((c, i) => (
            <Card key={i} {...c} />
          ))}
        </div>
      </div>
    </div>
  );
}
