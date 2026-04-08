import { useEffect, useState } from "react";

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

    axes[a] = { severity };
  });

  return { axes };
}

export default function App() {
  const [report, setReport] = useState(null);

  // ✅ Axis animation state
  const [axis, setAxis] = useState("roll");
  const [visibleAxis, setVisibleAxis] = useState("roll");
  const [isExiting, setIsExiting] = useState(false);

  function handleAxisChange(nextAxis) {
    if (nextAxis === axis) return;
    setIsExiting(true);

    setTimeout(() => {
      setAxis(nextAxis);
      setVisibleAxis(nextAxis);
      setIsExiting(false);
    }, 200); // must match CSS exit duration
  }

  return (
    <div className="app">
      <style>{`
        body {
          margin: 0;
          font-family: Inter, system-ui, sans-serif;
          background: radial-gradient(circle at top, #0b1220, #020617);
          color: #e5e7eb;
        }

        /* ===== Animations ===== */
        @keyframes enter {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes exit {
          from { opacity: 1; transform: translateY(0); }
          to   { opacity: 0; transform: translateY(12px); }
        }

        .top-bar {
          font-size: 28px;
          font-weight: 600;
          color: #ef4444;
          border-bottom: 2px solid #ef4444;
          margin: 16px;
        }

        .axis-tabs {
          display: flex;
          gap: 8px;
          margin: 16px;
        }

        .axis-tabs button {
          flex: 1;
          padding: 10px;
          background: #020617;
          border: 1px solid #334155;
          border-radius: 6px;
          color: #e5e7eb;
          cursor: pointer;
        }

        .axis-tabs button.active {
          background: #334155;
        }

        .card {
          background: #020617;
          border-left: 6px solid;
          padding: 16px;
          margin: 16px;
          border-radius: 6px;
          animation: enter 220ms ease-out forwards;
        }

        .card.exit {
          animation: exit 200ms ease-in forwards;
        }

        .CRITICAL { border-color: #ef4444; }
        .WARNING  { border-color: #f59e0b; }

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
        style={{ marginLeft: 16 }}
        onChange={e =>
          parseCSV(
            e.target.files[0],
            d => setReport(analyze(d)),
            console.error
          )
        }
      />

      {report && (
        <>
          <div className="axis-tabs">
            {AXES.map(a => (
              <button
                key={a}
                className={visibleAxis === a ? "active" : ""}
                onClick={() => handleAxisChange(a)}
              >
                {a.toUpperCase()}
              </button>
            ))}
          </div>

          {/* === ANIMATED CARDS === */}
          {report.axes[axis].severity === "CRITICAL" && (
            <div className={`card CRITICAL ${isExiting ? "exit" : ""}`}>
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
          )}

          {(report.axes[axis].severity === "CRITICAL" ||
            report.axes[axis].severity === "WARNING") && (
            <div className={`card WARNING ${isExiting ? "exit" : ""}`}>
              <div className="card-title">WARNING</div>
              High Overshoot
              <div className="param">
                <span>{axis}_p</span>
                <span>Reduce 5–10%</span>
              </div>
            </div>
          )}

          {report.axes[axis].severity === "OK" && (
            <div className={`card ${isExiting ? "exit" : ""}`}>
              <div className="card-title">OK</div>
              No issues detected on this axis.
            </div>
          )}
        </>
      )}
    </div>
  );
}
