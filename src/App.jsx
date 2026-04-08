import { useState } from "react";

export default function App() {
  const [info, setInfo] = useState(null);
  const [samples, setSamples] = useState([]);
  const [error, setError] = useState("");

  function loadFile(e) {
    setInfo(null);
    setSamples([]);
    setError("");

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

        // Detect delimiter
        let delimiter = ",";
        if (lines[0].includes("\t")) delimiter = "\t";
        else if (lines[0].includes(";")) delimiter = ";";

        const headers = lines[0].split(delimiter).map(h => h.trim());

        const timeIdx = headers.indexOf("time");
        const gyroIdx = headers.indexOf("gyro[0]");

        if (timeIdx === -1 || gyroIdx === -1) {
          throw new Error(
            `Required columns not found.
Found headers: ${headers.join(", ")}`
          );
        }

        const parsed = lines.slice(1)
          .map((line) => {
            const parts = line.split(delimiter);
            return {
              time: Number(parts[timeIdx]),
              gyro: Number(parts[gyroIdx])
            };
          })
          .filter(r =>
            Number.isFinite(r.time) && Number.isFinite(r.gyro)
          );

        if (parsed.length === 0) {
          throw new Error("No numeric data rows detected");
        }

        setInfo({
          fileName: file.name,
          totalLines: lines.length,
          delimiter,
          headers
        });

        setSamples(parsed.slice(0, 5)); // show first 5 rows only
      } catch (err) {
        setError(err.message);
      }
    };

    reader.readAsText(file);
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 2 (CSV Parsing)</h1>

      <p>
        This step validates that CSV parsing is correct.
        No charts yet.
      </p>

      <input type="file" accept=".csv,.txt" onChange={loadFile} />

      {error && (
        <div style={{ marginTop: 12, color: "red", whiteSpace: "pre-wrap" }}>
          ❌ {error}
        </div>
      )}

      {info && (
        <div style={{ marginTop: 16 }}>
          <h3>File Info</h3>
          <div><b>Name:</b> {info.fileName}</div>
          <div><b>Total lines:</b> {info.totalLines}</div>
          <div><b>Delimiter:</b> {JSON.stringify(info.delimiter)}</div>

          <h3 style={{ marginTop: 12 }}>Headers</h3>
          <pre>{JSON.stringify(info.headers, null, 2)}</pre>

          <h3 style={{ marginTop: 12 }}>First Parsed Rows</h3>
          <pre>{JSON.stringify(samples, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
