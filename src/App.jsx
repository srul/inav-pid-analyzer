import { useEffect, useState } from "react";

/* ================= CONFIG ================= */
const AXES = ["roll", "pitch", "yaw"];

/* ================= CSV ================= */
function parseCSV(file, onSuccess, onError) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const lines = String(r.result).split(/\r?\n/).filter(Boolean);
      const delim = lines[0].includes(";")
        ? ";"
        : lines[0].includes("\t")
        ? "\t"
        : ",";
      const headers = lines[0].split(delim);
      const idx = h => headers.indexOf(h);
      const t = idx("time");

      const data = lines.slice(1).map(l => {
        const p = l.split(delim);
        const row = { time: +p[t] };
        AXES.forEach((a, i) => {
          row[a] = {
            gyro: +p[idx(`gyro[${i}]`)],
            set: +p[idx(`setpoint[${i}]`)],
          };
        });
        return row;
      }).filter(r => !isNaN(r.time));

      onSuccess(data);
    } catch (e) {
      onError(e.message);
    }
  };
  r.readAsText(file);
}

/* ================= ANALYSIS ================= */
function analyze(data) {
  const axes = {};
  let global = "OK";

  AXES.forEach(a => {
    const g = data.map(r => r[a].gyro);
    const s = data.map(r => r[a].set);
    const fs = s.at(-1);

    if (Math.abs(fs) < 1e-6) {
      axes[a] = { severity: "OK" };
      return;
    }

    const peak = Math.max(...g);
    const overshoot = ((peak - fs) / Math.abs(fs)) * 100;

    let severity = "OK";
    if (overshoot > 15) severity = "WARNING";
    if (overshoot > 30) severity = "CRITICAL";

    if (severity === "CRITICAL") global = "CRITICAL";
    if (severity === "WARNING" && global !== "CRITICAL")
      global = "WARNING";

    axes[a] = { severity, overshoot: overshoot.toFixed(1) };
  });

  return { global, axes };
}

/* ================= APP ================= */
export default function App() {
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [axis, setAxis] = useState("roll");
  const [error, setError] = useState("");

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

        .top-bar {
          font-size: 28px;
          font-weight: 600;
          color: #ef4444;
          border-bottom: 2px solid #ef4444;
          margin-bottom: 16px;
          animation: fadeSlideIn 200ms ease-out;
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
        }

        .axis-tabs button.active {
          background: #334155;
        }

        .card {
          background: #020617;
          border-left: 6px solid;
          padding: 16px;
          margin-bottom: 16px;
          border-radius: 6px;
          animation: fadeSlideIn 260ms ease-out both;
        }

        .card.CRITICAL {
          border-color: #ef4444;
          animation:
            fadeSlideIn 260ms ease-out both,
            criticalPulse 2.4s ease-in-out infinite;
        }

        .card.WARNING {
          border-color: #f59e0b;
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

      <input
        type="file"
        accept=".csv"
        onChange={e =>
          parseCSV(
            e.target.files[0],
            d => {
              setData(d);
              setReport(analyze(d));
            },
            setError
          )
        }
      />

      {error && <div style={{ color: "red" }}>{error}</div>}

      {report && (
        <>
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

          {/* === FIXED RENDER LOGIC === */}
          {report.axes[axis].severity === "CRITICAL" && (
            <div className="card CRITICAL">
              <div className="card-title">CRITICAL</div>
              Enable Harmonic Notch Filter
              <div className="param">
                <span>gyro_notch1_hz</span>
                <span>120 Hz</span>
              </div>
              <div className="param">
                <span>gyro_notch1_cutoff</span>
                <span>60 Hz</span>
              </div>
            </div>
          )}

          {(report.axes[axis].severity === "CRITICAL" ||
            report.axes[axis].severity === "WARNING") && (
            <div className="card WARNING">
              <div className="card-title">WARNING</div>
              High Overshoot
              <div className="param">
                <span>{axis}_p</span>
                <span>Reduce 5–10%</span>
              </div>
            </div>
          )}

          {report.axes[axis].severity === "OK" && (
            <div className="card">
              <div className="card-title">OK</div>
              No issues detected on this axis.
            </div>
          )}
        </>
      )}
    </div>
  );
}
