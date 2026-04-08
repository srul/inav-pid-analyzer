import { useState } from "react";

const AXES = [
  { key: "roll", label: "Roll" },
  { key: "pitch", label: "Pitch" },
  { key: "yaw", label: "Yaw" },
];

function parseCSV(file, onSuccess, onError) {
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
        throw new Error("Missing required columns");
      }

      const data = lines.slice(1).map(line => {
        const p = line.split(delimiter);
        return {
          time: Number(p[timeIdx]),
          roll: { gyro: Number(p[gIdx.roll]), set: Number(p[sIdx.roll]) },
          pitch: { gyro: Number(p[gIdx.pitch]), set: Number(p[sIdx.pitch]) },
          yaw: { gyro: Number(p[gIdx.yaw]), set: Number(p[sIdx.yaw]) },
        };
      }).filter(r => Number.isFinite(r.time));

      onSuccess(data);
    } catch (e) {
      onError(e.message);
    }
  };
  reader.readAsText(file);
}

function computeMetrics(data, axis) {
  if (!data.length) return null;

  const gyro = data.map(r => r[axis].gyro);
  const setp = data.map(r => r[axis].set);
  const time = data.map(r => r.time);

  const finalSet = setp[setp.length - 1];
  if (finalSet === 0) return null;

  const peak = Math.max(...gyro);
  const overshootPct = ((peak - finalSet) / Math.abs(finalSet)) * 100;

  const tail = Math.floor(gyro.length * 0.9);
  const sse =
    gyro.slice(tail)
      .map((g, i) => g - setp[tail + i])
      .reduce((a, b) => a + b, 0) /
    (gyro.length - tail);

  const band = Math.abs(finalSet) * 0.05;
  let settlingTime = null;
  for (let i = 0; i < gyro.length; i++) {
    if (
      Math.abs(gyro[i] - finalSet) <= band &&
      gyro.slice(i).every(g => Math.abs(g - finalSet) <= band)
    ) {
      settlingTime = time[i];
      break;
    }
  }

  return { overshootPct, sse, settlingTime };
}

function makePath(data, axis, key, w, h, pad, minY, maxY) {
  const minX = data[0].time;
  const maxX = data[data.length - 1].time;

  return data.map((d, i) => {
    const x = pad + ((d.time - minX) / (maxX - minX)) * (w - 2 * pad);
    const y =
      h - pad - ((d[axis][key] - minY) / (maxY - minY)) * (h - 2 * pad);
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");
}

export default function App() {
  const [axis, setAxis] = useState("roll");
  const [baseline, setBaseline] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [error, setError] = useState("");

  const bMetrics = baseline && computeMetrics(baseline, axis);
  const cMetrics = candidate && computeMetrics(candidate, axis);

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 7 (Compare Runs)</h1>

      <div style={{ marginBottom: 10 }}>
        <b>Baseline CSV:</b>{" "}
        <input
          type="file"
          accept=".csv"
          onChange={e =>
            parseCSV(e.target.files[0], setBaseline, setError)
          }
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <b>Candidate CSV:</b>{" "}
        <input
          type="file"
          accept=".csv"
          onChange={e =>
            parseCSV(e.target.files[0], setCandidate, setError)
          }
        />
      </div>

      {error && <div style={{ color: "red" }}>❌ {error}</div>}

      {(baseline || candidate) && (
        <div style={{ marginTop: 10 }}>
          Axis:&nbsp;
          {AXES.map(a => (
            <button
              key={a.key}
              onClick={() => setAxis(a.key)}
              style={{
                marginRight: 6,
                background: axis === a.key ? "#ddd" : "#fff",
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {(baseline || candidate) && (
        <svg
          width={800}
          height={300}
          style={{ marginTop: 20, border: "1px solid #ccc" }}
        >
          {(() => {
            const pad = 30;
            const all = [...(baseline || []), ...(candidate || [])];
            const ys = all.flatMap(r => [
              r[axis].gyro,
              r[axis].set,
            ]);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);

            return (
              <>
                {baseline && (
                  <>
                    <path
                      d={makePath(baseline, axis, "set", 800, 300, pad, minY, maxY)}
                      stroke="blue"
                      strokeDasharray="4 4"
                      fill="none"
                    />
                    <path
                      d={makePath(baseline, axis, "gyro", 800, 300, pad, minY, maxY)}
                      stroke="blue"
                      fill="none"
                    />
                  </>
                )}
                {candidate && (
                  <>
                    <path
                      d={makePath(candidate, axis, "set", 800, 300, pad, minY, maxY)}
                      stroke="green"
                      strokeDasharray="4 4"
                      fill="none"
                    />
                    <path
                      d={makePath(candidate, axis, "gyro", 800, 300, pad, minY, maxY)}
                      stroke="green"
                      fill="none"
                    />
                  </>
                )}
              </>
            );
          })()}
        </svg>
      )}

      {(bMetrics || cMetrics) && (
        <div style={{ marginTop: 20 }}>
          <h3>Metrics Comparison</h3>
          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th></th>
                <th>Overshoot (%)</th>
                <th>SSE</th>
                <th>Settling Time (s)</th>
              </tr>
            </thead>
            <tbody>
              {bMetrics && (
                <tr>
                  <td>Baseline</td>
                  <td>{bMetrics.overshootPct.toFixed(2)}</td>
                  <td>{bMetrics.sse.toFixed(3)}</td>
                  <td>{bMetrics.settlingTime?.toFixed(3) ?? "—"}</td>
                </tr>
              )}
              {cMetrics && (
                <tr>
                  <td>Candidate</td>
                  <td>{cMetrics.overshootPct.toFixed(2)}</td>
                  <td>{cMetrics.sse.toFixed(3)}</td>
                  <td>{cMetrics.settlingTime?.toFixed(3) ?? "—"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
