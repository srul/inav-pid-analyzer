import { useState } from "react";
import Plot from "react-plotly.js";

export default function App() {
  const [fileInfo, setFileInfo] = useState(null);
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [error, setError] = useState("");

  function loadFile(e) {
    setError("");
    setRows([]);
    setHeaders([]);
    setFileInfo(null);

    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const lines = text.split(/\r?\n/).filter(l => l.trim().length);

        if (lines.length === 0) {
          throw new Error("File is empty");
        }

        // delimiter detection
        let delimiter = ",";
        if (lines[0].includes("\t")) delimiter = "\t";
        else if (lines[0].includes(";")) delimiter = ";";

        const hdrs = lines[0].split(delimiter).map(h => h.trim());
        setHeaders(hdrs);

        const timeIdx = hdrs.indexOf("time");
        const gyroIdx = hdrs.indexOf("gyro[0]");

        if (timeIdx === -1 || gyroIdx === -1) {
          throw new Error(
            `Missing required columns. Found headers: ${hdrs.join(", ")}`
          );
        }

        const parsed = lines.slice(1).map((line, i) => {
          const parts = line.split(delimiter);
          return {
            time: Number(parts[timeIdx]),
            gyro: Number(parts[gyroIdx])
          };
        }).filter(r =>
          Number.isFinite(r.time) && Number.isFinite(r.gyro)
        );

        if (parsed.length === 0) {
          throw new Error("No valid numeric rows after parsing");
        }

        setFileInfo({
          name: file.name,
          size: file.size,
          lines: lines.length
        });
        setRows(parsed);
      } catch (err) {
        setError(err.message);
      }
    };

    reader.readAsText(file);
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 1 DEBUG</h1>

      <p style={{ color: "#555" }}>
        This page must always show text after file selection.
      </p>

      <input type="file" accept=".csv,.txt" onChange={loadFile} />

      {error && (
        <div style={{ marginTop: 12, color: "red", whiteSpace: "pre-wrap" }}>
          ❌ ERROR: {error}
        </div>
      )}

      {fileInfo && (
        <div style={{ marginTop: 12 }}>
          <b>File:</b> {fileInfo.name}<br />
          <b>Size:</b> {fileInfo.size} bytes<br />
          <b>Total lines:</b> {fileInfo.lines}
        </div>
      )}

      {headers.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <b>Headers:</b>
          <pre>{JSON.stringify(headers, null, 2)}</pre>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <b>Parsed rows:</b> {rows.length}
      </div>

      {rows.length > 0 && (
        <>
          <div style={{ marginTop: 12 }}>
            <b>First row:</b>
            <pre>{JSON.stringify(rows[0], null, 2)}</pre>
          </div>

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
                xaxis: { title: "Time" },
                yaxis: { title: "Gyro" },
                height: 400
              }}
              style={{ width: "100%" }}
            />
          </div>
        </>
      )}
    </div>
  );
}
