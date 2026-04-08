import { useState } from "react";

const AXES = [
  { key: "roll", label: "Roll" },
  { key: "pitch", label: "Pitch" },
  { key: "yaw", label: "Yaw" },
];

export default function App() {
  const [info, setInfo] = useState(null);
  const [rows, setRows] = useState([]);
  const [axisKey, setAxisKey] = useState("roll");
  const [error, setError] = useState("");

  function loadFile(e) {
    setInfo(null);
    setRows([]);
    setError("");

    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const lines = text.split(/\r?\n/).filter(l => l.trim().length);
        if (lines.length === 0) throw new Error("File is empty");

        let delimiter = ",";
        if (lines[0].includes("\t")) delimiter = "\t";
        else if (lines[0].includes(";")) delimiter = ";";

        const headers = lines[0].split(delimiter).map(h => h.trim());

        const timeIdx = headers.indexOf("time");
        const gIdx = {
          roll: headers.indexOf("gyro[0]"),
          pitch: headers.indexOf("gyro[1]"),
          yaw: headers.indexOf("gyro[2]"),
        };
        const sIdx = {
          roll: headers.indexOf("setpoint[0]"),
          pitch: headers.indexOf("setpoint[1]"),
          yaw: headers.indexOf("setpoint[2]"),
        };

        if (
          timeIdx === -1 ||
          Object.values(gIdx).some(v => v === -1) ||
          Object.values(sIdx).some(v => v === -1)
        ) {
          throw new Error(`Missing required columns`);
        }

        const parsed = lines.slice(1).map(line => {
          const p = line.split(delimiter);
          return {
            time: Number(p[timeIdx]),
            roll: { gyro: Number(p[gIdx.roll]), set: Number(p[sIdx.roll]) },
            pitch: { gyro: Number(p[gIdx.pitch]), set: Number(p[sIdx.pitch]) },
            yaw: { gyro: Number(p[gIdx.yaw]), set: Number(p[sIdx.yaw]) },
          };
        }).filter(r => Number.isFinite(r.time));

        setInfo({ name: file.name, rows: parsed.length });
        setRows(parsed);
      } catch (err) {
        setError(err.message);
      }
    };

    reader.readAsText(file);
  }

  // ===== METRICS =====

  function computeMetrics(data, axis) {
    if (!data.length) return null;

    const gyro = data.map(r => r[axis].gyro);
    const setp = data.map(r => r[axis].set);
    const time = data.map(r => r.time);

    const finalSet = setp[setp.length - 1];
    if (finalSet === 0) return null;

    // Overshoot
    const peak = Math.max(...gyro);
    const overshootPct = ((peak - finalSet) / Math.abs(finalSet)) * 100;

    // Steady‑state error (last 10%)
    const tailStart = Math.floor(gyro.length * 0.9);
    const sse =
      gyro.slice(tailStart)
        .map((g, i) => g - setp[tailStart + i])
        .reduce((a, b) => a + b, 0) /
      (gyro.length - tailStart);

    // Settling time (±5%)
    const band = Math.abs(finalSet) * 0.05;
    let settlingTime = null;
    for (let i = 0; i < gyro.length; i++) {
      const within = Math.abs(gyro[i] - finalSet) <= band;
      if (
        within &&
        gyro.slice(i).every(g => Math.abs(g - finalSet) <= band)
      ) {
        settlingTime = time[i];
        break;
      }
    }

    return {
      overshootPct,
      sse,
      settlingTime,
    };
  }

  function makePath(data, axis, key, w, h, pad, minY, maxY) {
    const minX = data[0].time;
    const maxX = data[data.length - 1].time;

    return data.map((d, i) => {
      const x =
        pad + ((d.time - minX) / (maxX - minX)) * (w - 2 * pad);
      const y =
        h - pad -
        ((d[axis][key] - minY) / (maxY - minY)) * (h - 2 * pad);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    }).join(" ");
  }

  const metrics = computeMetrics(rows, axisKey);

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 6 (Basic Metrics)</h1>

      <input type="file" accept=".csv,.txt" onChange={loadFile} />

      {error && <div style={{ color: "red", marginTop: 10 }}>❌ {error}</div>}

      {info && (
        <div style={{ marginTop: 10 }}>
          <b>File:</b> {info.name}<br />
          <b>Rows:</b> {info.rows}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ marginTop: 15 }}>
            Axis:&nbsp;
            {AXES.map(a => (
              <button
                key={a.key}
                onClick={() => setAxisKey(a.key)}
                style={{
                  marginRight: 6,
                  background: axisKey === a.key ? "#ddd" : "#fff",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {metrics && (
            <div style={{ marginTop: 15 }}>
              <h3>Metrics</h3>
              <ul>
                <li><b>Overshoot:</b> {metrics.overshootPct.toFixed(2)} %</li>
                <li><b>Steady‑State Error:</b> {metrics.sse.toFixed(3)}</li>
                <li>
                  <b>Settling Time:</b>{" "}
                  {metrics.settlingTime !== null
                    ? `${metrics.settlingTime.toFixed(3)} s`
                    : "Not settled"}
                </li>
              </ul>
            </div>
          )}

          {(() => {
            const w = 800, h = 300, pad = 30;
            const ys = rows.flatMap(r => [
              r[axisKey].gyro,
              r[axisKey].set,
            ]);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);

            return (
              <svg
                width={w}
                height={h}
                style={{
                  marginTop: 20,
                  border: "1px solid #ccc",
                  background: "#fafafa",
                }}
              >
                {/* Setpoint */}
                <path
                  d={makePath(rows, axisKey, "set", w, h, pad, minY, maxY)}
                  fill="none"
                  stroke="red"
                  strokeDasharray="6 4"
                  strokeWidth="2"
                />
                {/* Gyro */}
                <path
                  d={makePath(rows, axisKey, "gyro", w, h, pad, minY, maxY)}
                  fill="none"
                  stroke="#0070f3"
                  strokeWidth="2"
                />
              </svg>
            );
          })()}
        </>
      )}
    </div>
  );
}
