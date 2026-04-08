import { useEffect, useState } from "react";

const AXES = ["roll", "pitch", "yaw"];

export default function App() {
  const [axis, setAxis] = useState("roll");

  const report = {
    global: "CRITICAL",
    axes: {
      roll: { severity: "CRITICAL" },
      pitch: { severity: "OK" },
      yaw: { severity: "OK" },
    },
  };

  return (
    <div className="app analyzer">
      <style>{`
        body {
          margin: 0;
          font-family: Inter, system-ui, sans-serif;
          background: radial-gradient(circle at top, #0b1220, #020617);
          color: #e5e7eb;
        }

        /* ===== Animations ===== */
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes criticalPulse {
          0% { box-shadow: 0 0 0 rgba(239,68,68,0); }
          50% { box-shadow: 0 0 18px rgba(239,68,68,0.35); }
          100% { box-shadow: 0 0 0 rgba(239,68,68,0); }
        }

        @keyframes warningPulse {
          0% { box-shadow: 0 0 0 rgba(245,158,11,0); }
          50% { box-shadow: 0 0 14px rgba(245,158,11,0.35); }
          100% { box-shadow: 0 0 0 rgba(245,158,11,0); }
        }

        .top-bar {
          font-size: 28px;
          font-weight: 600;
          color: #ef4444;
          border-bottom: 2px solid #ef4444;
          padding-bottom: 8px;
          margin-bottom: 16px;
          animation: fadeSlideIn 220ms ease-out;
        }

        .axis-tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
        }

        .axis-tabs button {
          flex: 1;
          padding: 10px;
          background: #020617;
          border: 1px solid #334155;
          color: #e5e7eb;
          border-radius: 6px;
          cursor: pointer;
          transition: transform 120ms ease, box-shadow 120ms ease;
        }

        .axis-tabs button:hover {
          transform: translateY(-1px);
        }

        .axis-tabs button.active {
          transform: scale(1.02);
          box-shadow: 0 0 12px rgba(148,163,184,0.35);
          background: #334155;
        }

        .card {
          background: #020617;
          border-left: 6px solid;
          padding: 16px;
          margin-bottom: 16px;
          border-radius: 6px;
          animation: fadeSlideIn 280ms ease-out both;
        }

        .card.CRITICAL {
          border-color: #ef4444;
          animation:
            fadeSlideIn 280ms ease-out both,
            criticalPulse 2.4s ease-in-out infinite;
        }

        .card.WARNING {
          border-color: #f59e0b;
          animation:
            fadeSlideIn 280ms ease-out both,
            warningPulse 3s ease-in-out infinite;
        }

        .card-title {
          font-weight: 600;
          margin-bottom: 6px;
        }

        .param {
          display: flex;
          justify-content: space-between;
          font-family: monospace;
          font-size: 13px;
        }
      `}</style>

      <div className="top-bar">Tune Needs Attention</div>

      <div className="axis-tabs">
        {AXES.map(a => (
          <button
            key={a}
            className={axis === a ? "active" : ""}
            onClick={() => setAxis(a)}
          >
            {a.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="card CRITICAL">
        <div className="card-title">CRITICAL</div>
        Enable Harmonic Notch Filter
        <div className="param">
          <span>gyro_notch1_hz</span>
          <span>120 Hz</span>
        </div>
        <div className="param">
          <span>gyro_notch1_cutoff</span>
          <span>60 Hz</span>
        </div>
      </div>

      <div className="card WARNING">
        <div className="card-title">WARNING</div>
        High Overshoot
        <div className="param">
          <span>roll_p</span>
          <span>Reduce 5–10%</span>
        </div>
      </div>
    </div>
  );
}
