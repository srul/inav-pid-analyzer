import { useMemo, useState, lazy, Suspense } from "react";
import "./App.css";

// Lazy-load Plotly chunk
const Plot = lazy(() => import("react-plotly.js"));

/* ---------------- helpers ---------------- */

function normalizeHeader(h) {
  return String(h ?? "").trim();
}

function lowerHeaders(headers) {
  return headers.map((h) => normalizeHeader(h).toLowerCase());
}

function pickFirst(headers, candidates) {
  const lower = lowerHeaders(headers);
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  return "";
}

function pickByIncludes(headers, includesList) {
  const lower = lowerHeaders(headers);
  const picked = [];
  for (const inc of includesList) {
    const idx = lower.findIndex((h) => h.includes(inc.toLowerCase()));
    if (idx !== -1) picked.push(headers[idx]);
  }
  return Array.from(new Set(picked));
}

function guessColumns(headers) {
  // Time candidates
  const time = pickFirst(headers, [
    "time",
    "time_s",
    "time_us",
    "timestamp",
    "loopIteration",
    "looptime",
    "t",
  ]);

  // Gyro candidates (varies by exporter/tool)
  const gyro = pickByIncludes(headers, [
    "gyro_roll",
    "gyro_pitch",
    "gyro_yaw",
    "gyroadc[0]",
    "gyroadc[1]",
    "gyroadc[2]",
    "gyro[0]",
    "gyro[1]",
    "gyro[2]",
    "gyrofilt[0]",
    "gyrofilt[1]",
    "gyrofilt[2]",
  ]).slice(0, 3);

  // Setpoint candidates (common names)
  // iNav CSV export names can vary; these patterns cover many exports.
  const setpoint = pickByIncludes(headers, [
    "setpoint_roll",
    "setpoint_pitch",
    "setpoint_yaw",
    "setpoint[0]",
    "setpoint[1]",
    "setpoint[2]",
    "rccommand[0]",
    "rccommand[1]",
    "rccommand[2]",
    "rc_command[0]",
    "rc_command[1]",
    "rc_command[2]",
    "rccommandroll",
    "rccommandpitch",
    "rccommandyaw",
  ]).slice(0, 3);

  return { time, gyro, setpoint };
}

function downsampleXY(x, y, maxPoints = 20000) {
  const n = Math.min(x.length, y.length);
  if (n <= maxPoints) return { x: x.slice(0, n), y: y.slice(0, n) };

  const step = Math.ceil(n / maxPoints);
  const xs = [];
  const ys = [];

  for (let i = 0; i < n; i += step) {
    xs.push(x[i]);
    ys.push(y[i]);
  }

  // ensure last point
  if (xs[xs.length - 1] !== x[n - 1]) {
    xs.push(x[n - 1]);
    ys.push(y[n - 1]);
  }

  return { x: xs, y: ys };
}

/* ---------------- component ---------------- */

export default function App() {
  const [fileInfo, setFileInfo] = useState(null);
  const [error, setError] = useState("");

  const [timeCol, setTimeCol] = useState("");
  const [gyroCols, setGyroCols] = useState([]);
  const [setpointCols, setSetpointCols] = useState([]);

  const [autoDetected, setAutoDetected] = useState({ time: "", gyro: [], setpoint: [] });

  const [showSetpoint, setShowSetpoint] = useState(true);
  const [maxPoints, setMaxPoints] = useState(20000);

  function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a CSV file (Blackbox CSV export).");
      setFileInfo(null);
      setTimeCol("");
      setGyroCols([]);
      setSetpointCols([]);
      return;
    }

    setError("");

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

        if (lines.length < 2) {
          setError("CSV file is empty or invalid.");
          setFileInfo(null);
          return;
        }

        const headers = lines[0].split(",").map(normalizeHeader);

        const rows = lines.slice(1).map((line) => {
          const values = line.split(",");
          const obj = {};
          headers.forEach((h, i) => {
            const raw = values[i] ?? "";
            const v = String(raw).trim();
            const n = Number(v);
            obj[h] = v === "" ? null : (Number.isFinite(n) ? n : v);
          });
          return obj;
        });

        const guessed = guessColumns(headers);

        setFileInfo({
          name: file.name,
          headers,
          rows,
        });

        setAutoDetected(guessed);

        // Apply auto selections
        setTimeCol(guessed.time || "");
        setGyroCols(guessed.gyro || []);
        setSetpointCols(guessed.setpoint || []);

        // Enable overlay automatically only if we detected setpoint cols
        setShowSetpoint((guessed.setpoint || []).length > 0);

      } catch (e) {
        setError("Failed to parse CSV. Please export again from Blackbox Explorer.");
        setFileInfo(null);
      }
    };

    reader.readAsText(file);
  }

  function applyAutoDetected() {
    setTimeCol(autoDetected.time || "");
    setGyroCols(autoDetected.gyro || []);
    setSetpointCols(autoDetected.setpoint || []);
    setShowSetpoint((autoDetected.setpoint || []).length > 0);
  }

  const canPlot = !!fileInfo && !!timeCol && gyroCols.length > 0;

  // Build plot traces
  const plotData = useMemo(() => {
    if (!canPlot) return [];

    // build time vector once
    const xAll = fileInfo.rows.map((r) => r[timeCol]);
    // keep only finite numbers or strings that are not null
    // (Plotly can handle numeric time or integer loop counters)
    const x = xAll.map((v) => v).filter((v) => v !== null && v !== undefined);

    const traces = [];

    // Gyro traces (solid)
    gyroCols.forEach((col) => {
      const yAll = fileInfo.rows.map((r) => r[col]);
      const n = Math.min(x.length, yAll.length);
      const ds = downsampleXY(x.slice(0, n), yAll.slice(0, n), maxPoints);

      traces.push({
        x: ds.x,
        y: ds.y,
        type: "scatter",
        mode: "lines",
        name: `Gyro: ${col}`,
        line: { width: 2 },
      });
    });

    // Setpoint traces (dashed)
    if (showSetpoint && setpointCols.length > 0) {
      setpointCols.forEach((col) => {
        const yAll = fileInfo.rows.map((r) => r[col]);
        const n = Math.min(x.length, yAll.length);
        const ds = downsampleXY(x.slice(0, n), yAll.slice(0, n), maxPoints);

        traces.push({
          x: ds.x,
          y: ds.y,
          type: "scatter",
          mode: "lines",
          name: `Setpoint: ${col}`,
          line: { width: 2, dash: "dash" },
        });
      });
    }

    return traces;
  }, [fileInfo, timeCol, gyroCols, setpointCols, showSetpoint, maxPoints, canPlot]);

  return (
    <div className="app">
      <header className="header">
        <h1>iNav PID Analyzer</h1>
        <p>Overlay Gyro vs Setpoint from iNav Blackbox CSV</p>
      </header>

      <main className="main">
        {/* Upload */}
        <section className="upload-card">
          <h2>Upload log file</h2>
          <p style={{ marginTop: 0, color: "#6b7280" }}>Supported: Blackbox CSV export</p>

          <input type="file" accept=".csv" onChange={handleFileUpload} />

          {error && <p className="error">{error}</p>}

          {!fileInfo && !error && <p style={{ marginTop: 12 }}>No log loaded</p>}

          {fileInfo && (
            <div style={{ marginTop: 12 }}>
              <p><strong>File:</strong> {fileInfo.name}</p>
              <p><strong>Rows:</strong> {fileInfo.rows.length}</p>

              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={applyAutoDetected}>
                  Apply auto-detected columns
                </button>
              </div>

              <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
                <div><strong>Auto Time:</strong> {autoDetected.time || "(not found)"}</div>
                <div><strong>Auto Gyro:</strong> {autoDetected.gyro?.length ? autoDetected.gyro.join(", ") : "(not found)"}</div>
                <div><strong>Auto Setpoint:</strong> {autoDetected.setpoint?.length ? autoDetected.setpoint.join(", ") : "(not found)"}</div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 13, color: "#374151" }}>
                  Max points per trace:&nbsp;
                  <select value={maxPoints} onChange={(e) => setMaxPoints(Number(e.target.value))}>
                    <option value={5000}>5,000</option>
                    <option value={10000}>10,000</option>
                    <option value={20000}>20,000</option>
                    <option value={50000}>50,000</option>
                  </select>
                </label>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  (Downsampling keeps the UI responsive for large logs.)
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={showSetpoint}
                    onChange={(e) => setShowSetpoint(e.target.checked)}
                  />
                  &nbsp;Show Setpoint overlay (dashed)
                </label>
              </div>
            </div>
          )}
        </section>

        {/* Controls + plot */}
        <section className="empty-state">
          {!fileInfo && <p>Upload a CSV file to start analysis.</p>}

          {fileInfo && (
            <div style={{ width: "100%" }}>
              <h3>Column selection</h3>

              {/* Time */}
              <div style={{ marginBottom: 12 }}>
                <label>
                  Time:&nbsp;
                  <select value={timeCol} onChange={(e) => setTimeCol(e.target.value)}>
                    <option value="">-- select --</option>
                    {fileInfo.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
                {!timeCol && (
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>
                    Couldn’t auto-detect time column — please select manually.
                  </div>
                )}
              </div>

              {/* Gyro */}
              <div style={{ marginBottom: 12 }}>
                <label>
                  Gyro (solid):<br />
                  <select
                    multiple
                    style={{ width: "100%", height: 110 }}
                    value={gyroCols}
                    onChange={(e) => setGyroCols(Array.from(e.target.selectedOptions).map((o) => o.value))}
                  >
                    {fileInfo.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
                {gyroCols.length === 0 && (
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>
                    Select at least one gyro column.
                  </div>
                )}
              </div>

              {/* Setpoint */}
              <div style={{ marginBottom: 20 }}>
                <label>
                  Setpoint (dashed):<br />
                  <select
                    multiple
                    style={{ width: "100%", height: 110 }}
                    value={setpointCols}
                    onChange={(e) => setSetpointCols(Array.from(e.target.selectedOptions).map((o) => o.value))}
                  >
                    {fileInfo.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
                {showSetpoint && setpointCols.length === 0 && (
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>
                    Overlay is ON but no setpoint columns selected.
                  </div>
                )}
              </div>

              {/* Plot */}
              {canPlot && (
                <Suspense fallback={<p>Loading chart…</p>}>
                  <Plot
                    data={plotData}
                    layout={{
                      title: "Gyro vs Setpoint Overlay",
                      xaxis: { title: timeCol },
                      yaxis: { title: "Value" },
                      legend: { orientation: "h" },
                      margin: { t: 50, l: 50, r: 20, b: 40 },
                    }}
                    style={{ width: "100%", height: 520 }}
                    config={{ responsive: true }}
                  />
                </Suspense>
              )}

              {!canPlot && (
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  Select a time column and at least one gyro signal to display the plot.
                </div>
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
