import { useState } from "react";

const AXES = [
  { key: "roll", label: "Roll", gyro: "gyro[0]", set: "setpoint[0]" },
  { key: "pitch", label: "Pitch", gyro: "gyro[1]", set: "setpoint[1]" },
  { key: "yaw", label: "Yaw", gyro: "gyro[2]", set: "setpoint[2]" },
];

export default function App() {
  const [info, setInfo] = useState(null);
  const [rows, setRows] = useState([]);
  const [axis, setAxis] = useState(AXES[0]);
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

        // Detect delimiter
        let delimiter = ",";
        if (lines[0].includes("\t")) delimiter = "\t";
        else if (lines[0].includes(";")) delimiter = ";";

        const headers = lines[0].split(delimiter).map(h => h.trim());

        const timeIdx = headers.indexOf("time");

        const gyroIdx = {
          roll: headers.indexOf("gyro[0]"),
          pitch: headers.indexOf("gyro[1]"),
          yaw: headers.indexOf("gyro[2]"),
        };

        const setIdx = {
          roll: headers.indexOf("setpoint[0]"),
          pitch: headers.indexOf("setpoint[1]"),
          yaw: headers.indexOf("setpoint[2]"),
        };

        if (
          timeIdx === -1 ||
          gyroIdx.roll === -1 ||
          gyroIdx.pitch === -1 ||
          gyroIdx.yaw === -1 ||
          setIdx.roll === -1 ||
          setIdx.pitch === -1 ||
          setIdx.yaw === -1
        ) {
          throw new Error(
            `Missing required columns.
Found headers: ${headers.join(", ")}`
          );
        }

        const parsed = lines.slice(1)
          .map(line => {
            const parts = line.split(delimiter);
            return {
              time: Number(parts[timeIdx]),
              roll: {
                gyro: Number(parts[gyroIdx.roll]),
                set: Number(parts[setIdx.roll]),
              },
              pitch: {
                gyro: Number(parts[gyroIdx.pitch]),
                set: Number(parts[setIdx.pitch]),
              },
              yaw: {
                gyro: Number(parts[gyroIdx.yaw]),
                set: Number(parts[setIdx.yaw]),
              },
            };
          })
          .filter(r =>
            Number.isFinite(r.time) &&
            Number.isFinite(r.roll.gyro) &&
            Number.isFinite(r.roll.set)
          );

        if (parsed.length === 0) {
          throw new Error("No numeric data rows found");
        }

        setInfo({
          name: file.name,
          rows: parsed.length,
        });

        setRows(parsed);
      } catch (err) {
        setError(err.message);
      }
    };

    reader.readAsText(file);
  }

  function makePath(data, key, w, h, pad, minY, maxY) {
    const minX = data[0].time;
    const maxX = data[data.length - 1].time;

    return data
      .map((d, i) => {
        const x =
          pad + ((d.time - minX) / (maxX - minX)) * (w - 2 * pad);
        const y =
          h - pad - ((d[key] - minY) / (maxY - minY)) * (h - 2 * pad);
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 5 (Axis Selector)</h1>

      <input type="file" accept=".csv,.txt" onChange={loadFile} />

      {error && (
        <div style={{ color: "red", marginTop: 10 }}>❌ {error}</div>
      )}

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
                onClick={() => setAxis(a)}
                style={{
                  marginRight: 6,
                  padding: "4px 10px",
                  border: "1px solid #ccc",
                  background:
                    a.key === axis.key ? "#ddd" : "#fff",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {(() => {
            const w = 800;
            const h = 300;
            const pad = 30;

            const ys = rows.flatMap(r => [
              r[axis.key].gyro,
              r[axis.key].set,
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
                  d={makePath(
                    rows.map(r => ({
                      time: r.time,
                      value: r[axis.key].set,
                    })),
                    "value",
                    w,
                    h,
                    pad,
                    minY,
                    maxY
                  )}
                  fill="none"
                  stroke="red"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />

                {/* Gyro */}
                <path
                  d={makePath(
                    rows.map(r => ({
                      time: r.time,
                      value: r[axis.key].gyro,
                    })),
                    "value",
                    w,
                    h,
                    pad,
                    minY,
                    maxY
                  )}
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
