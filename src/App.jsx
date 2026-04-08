import { useState } from "react";
import Plot from "react-plotly.js";

export default function App() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  function loadFile(e) {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const lines = text.split(/\r?\n/).filter(l => l.trim().length);

        // Detect delimiter
        const headerLine = lines[0];
        let delimiter = ",";
        if (headerLine.includes("\t")) delimiter = "\t";
        else if (headerLine.includes(";")) delimiter = ";";

        const headers = headerLine.split(delimiter).map(h => h.trim());

        const timeIdx = headers.indexOf("time");
        const gyroIdx = headers.indexOf("gyro[0]");

        if (timeIdx === -1 || gyroIdx === -1) {
          throw new Error(
            'CSV must contain columns "time" and "gyro[0]"'
          );
        }

        const data = lines.slice(1).map(line => {
          const parts = line.split(delimiter);
          return {
            time: Number(parts[timeIdx]),
            gyro: Number(parts[gyroIdx])
          };
        }).filter(r => Number.isFinite(r.time) && Number.isFinite(r.gyro));

        if (data.length === 0) {
          throw new Error("No numeric data rows found");
        }

        setRows(data);
      } catch (err) {
        setRows([]);
        setError(err.message);
      }
    };

    reader.readAsText(file);
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 1 (Baseline Plot)</h1>

      <input type="file" accept=".csv,.txt" onChange={loadFile} />

      {error && (
        <div style={{ color: "red", marginTop: 10 }}>
          ❌ {error}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <Plot
            data={[
              {
                x: rows.map(r => r.time),
                y: rows.map(r => r.gyro),
                type: "scatter",
                mode: "lines",
                name: "gyro[0]"
              }
            ]}
            layout={{
              title: "Gyro[0] vs Time",
              xaxis: { title: "Time (s)" },
              yaxis: { title: "Gyro rate" },
              height: 400
            }}
            style={{ width: "100%" }}
          />
        </div>
      )}
    </div>
  );
}
