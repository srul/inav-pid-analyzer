import { useState } from "react";
import jsPDF from "jspdf";

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

/* ================= EXPORT HELPERS ================= */
function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function exportPDF(report) {
  const doc = new jsPDF();
  let y = 10;

  doc.setFontSize(16);
  doc.text("PID Tuning Report", 10, y);
  y += 10;

  doc.setFontSize(11);
  doc.text(`Firmware: ${report.firmware}`, 10, y); y += 6;
  doc.text(`Global Severity: ${report.globalSeverity}`, 10, y); y += 8;

  report.entries.forEach(entry => {
    doc.setFontSize(13);
    doc.text(`${entry.axis.toUpperCase()} — ${entry.severity}`, 10, y);
    y += 6;

    doc.setFontSize(10);
    entry.cards.forEach(c => {
      doc.text(`• ${c.severity}: ${c.title}`, 12, y);
      y += 5;
      if (c.params) {
        c.params.forEach(p => {
          doc.text(
            `   ${p.name}: ${p.value}`,
            14,
            y
          );
          y += 4;
        });
      }
    });
    y += 6;
    if (y > 270) {
      doc.addPage();
      y = 10;
    }
  });

  doc.save("pid-tuning-report.pdf");
}

/* ================= DEMO DATA (from previous steps) ================= */
function buildDemoReport(firmware) {
  return {
    firmware,
    globalSeverity: "CRITICAL",
    generatedAt: new Date().toISOString(),
    entries: [
      {
        axis: "roll",
        severity: "CRITICAL",
        cards: [
          {
            severity: "CRITICAL",
            title: "Enable Harmonic Notch Filter",
            params: [
              { name: FIRMWARES[firmware].notchEnable, value: "1" },
              { name: FIRMWARES[firmware].notchFreq, value: "120 Hz" },
              { name: FIRMWARES[firmware].notchBW, value: "60 Hz" },
            ],
          },
          {
            severity: "WARNING",
            title: "High Overshoot",
            params: [
              { name: FIRMWARES[firmware].rateP, value: "Reduce 5–10%" },
            ],
          },
        ],
      },
      {
        axis: "pitch",
        severity: "OK",
        cards: [
          {
            severity: "OK",
            title: "No Issues Detected",
          },
        ],
      },
      {
        axis: "yaw",
        severity: "OK",
        cards: [
          {
            severity: "OK",
            title: "No Issues Detected",
          },
        ],
      },
    ],
  };
}

/* ================= APP ================= */
export default function App() {
  const [firmware, setFirmware] = useState("ArduPilot");

  const report = buildDemoReport(firmware);

  return (
    <div style={{
      background: "#020617",
      minHeight: "100vh",
      color: "#e5e7eb",
      padding: 20,
      maxWidth: 720,
      margin: "0 auto",
    }}>
      <h1>PID Analyzer — Step 16 (Export)</h1>

      <label>
        Firmware:&nbsp;
        <select
          value={firmware}
          onChange={e => setFirmware(e.target.value)}
        >
          {Object.keys(FIRMWARES).map(f => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>

      <div style={{ marginTop: 20 }}>
        <button
          onClick={() => downloadJSON(report, "pid-tuning-report.json")}
          style={{ marginRight: 10 }}
        >
          Export JSON
        </button>

        <button onClick={() => exportPDF(report)}>
          Export PDF
        </button>
      </div>

      <pre style={{
        marginTop: 20,
        background: "#020617",
        border: "1px solid #334155",
        padding: 12,
        borderRadius: 6,
        fontSize: 12,
        overflowX: "auto",
      }}>
        {JSON.stringify(report, null, 2)}
      </pre>
    </div>
  );
}
