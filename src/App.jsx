import { useState } from "react";
import Plot from "react-plotly.js";
import "./App.css";

export default function App() {
  const [fileInfo, setFileInfo] = useState(null);
  const [timeCol, setTimeCol] = useState("");
  const [signalCols, setSignalCols] = useState([]);

  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const lines = text.split(/\r?\n/).filter(Boolean);

      if (lines.length < 2) {
        alert("CSV file is empty or invalid");
        return;
      }

      const headers = lines[0].split(",");

      const rows = lines.slice(1).map((line) => {
        const values = line.split(",");
        const obj = {};
        headers.forEach((h, i) => {
          const v = values[i];
          const num = Number(v);
          obj[h] = isNaN(num) ? v : num;
        });
        return obj;
      });

      setFileInfo({
        name: file.name,
        headers,
        rows,
      });

      // reset selections when new file loaded
      setTimeCol("");
      setSignalCols([]);
    };

    reader.readAsText(file);
  }

  return (
    <div className="app">
      <header className="header">
        <h1>iNav PID Analyzer</h1>
        <p>Upload an iNav Blackbox CSV and visualize signals</p>
      </header>

      <main className="main">
        {/* Upload */}
        <section className="upload-card">
          <h2>Upload log file</h2>
          <input type="file" accept=".csv" onChange={handleFileUpload} />

          {!fileInfo && <p style={{ marginTop: 12 }}>No log loaded</p>}

          {fileInfo && (
            <div style={{ marginTop: 12 }}>
              <p>
                <strong>File:</strong> {fileInfo.name}
              </p>
              <p>
                <strong>Rows:</strong> {fileInfo.rows.length}
              </p>
            </div>
          )}
        </section>

        {/* Controls + plot */}
        <section className="empty-state">
          {!fileInfo && (
            <p>
              Upload a CSV file to start analysis.
            </p>
          )}

          {fileInfo && (
            <div style={{ width: "100%" }}>
              <h3>Signal selection</h3>

              {/* Time selector */}
              <div style={{ marginBottom: 12 }}>
                <label>
                  Time:&nbsp;
                  <select
                    value={timeCol}
                    onChange={(e) => setTimeCol(e.target.value)}
                  >
                    <option value="">-- select --</option>
                    {fileInfo.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Signal selector */}
              <div style={{ marginBottom: 20 }}>
                <label>
                  Signals (Roll / Pitch / Yaw):<br />
                  <select
                    multiple
                    style={{ width: "100%", height: 140 }}
                    value={signalCols}
                    onChange={(e) =>
                      setSignalCols(
                        Array.from(e.target.selectedOptions).map(
                          (o) => o.value
                        )
                      )
                    }
                  >
                    {fileInfo.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Plot */}
              {timeCol && signalCols.length > 0 && (
                <Plot
                  data={signalCols.map((col) => ({
                    x: fileInfo.rows.map((r) => r[timeCol]),
                    y: fileInfo.rows.map((r) => r[col]),
                    type: "scatter",
                    mode: "lines",
                    name: col,
                  }))}
                  layout={{
                    title: "iNav Signal Plot",
                    xaxis: { title: timeCol },
                    yaxis: { title: "Value" },
                    legend: { orientation: "h" },
                    margin: { t: 50, l: 50, r: 20, b: 40 },
                  }}
                  style={{ width: "100%", height: 520 }}
                  config={{ responsive: true }}
                />
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <span>Beta • iNav 9.x</span>
      </footer>
    </div>
  );
}
