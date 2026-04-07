import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import "./App.css";

// Lazy-load Plotly chunk (loads only when chart is shown)
const Plot = lazy(() => import("react-plotly.js"));

/** ---------- helpers ---------- **/

function normalizeHeader(h) {
  return String(h || "").trim();
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
  // de-dup
  return Array.from(new Set(picked));
}

function guessColumns(headers) {
  // Time candidates across tools/exporters
  const time = pickFirst(headers, [
    "time",
    "time_s",
    "time_us",
    "timestamp",
    "loopIteration",
    "looptime",
    "t",
  ]);

  // Gyro candidates vary (examples found in different ecosystems)
  // We'll try common human-readable and array forms.
  const gyroCandidates = pickByIncludes(headers, [
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
  ]);

  // Prefer exactly 3 columns if possible
  const signals = gyroCandidates.slice(0, 3);

  return { time, signals };
}

/**
 * Downsample arrays to at most maxPoints by striding.
 * Keeps first/last points, preserves shape well enough for v0.
 */
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

/** ---------- component ---------- **/

export default function App() {
  const [fileInfo, setFileInfo] = useState(null);
  const [error, setError] = useState("");

  const [timeCol, setTimeCol] = useState("");
  const [signalCols, setSignalCols] = useState([]);

  const [autoDetected, setAutoDetected] = useState({ time: "", signals: [] });
  const [maxPoints, setMaxPoints] = useState(20000);

  function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a CSV file (Blackbox CSV export).");
      setFileInfo(null);
      setTimeCol("");
      setSignalCols([]);
      return;
    }

    setError("");

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        const lines = String(text).split(/\r?\n/).filter((l) => l.trim().length > 0);
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
            const num = Number(v);
            obj[h] = v === "" ? null : (Number.isFinite(num) ? num : v);
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

        // Apply auto-detected selections immediately
        setTimeCol(guessed.time || "");
        setSignalCols(guessed.signals || []);
      } catch (e) {
        setError("Failed to parse CSV. Please export again from Blackbox Explorer.");
        setFileInfo(null);
      }
    };

    reader.readAsText(file);
  }

  // If user clears selectors, let them restore auto-detected quickly
  function applyAutoDetected() {
    setTimeCol(autoDetected.time || "");
    setSignalCols(autoDetected.signals || []);
  }

  // Build plot traces (memoized for performance)
  const plotData = useMemo(() => {
    if (!fileInfo || !timeCol || signalCols.length === 0) return [];

    const xRaw = fileInfo.rows.map((r) => r[timeCol]).filter((v) => v !== null && v !== undefined);

    // If time column is microseconds, it may be very large; we don’t force convert,
    // but we keep whatever the user selected.
    return signalCols.map((col) => {
      const yRaw = fileInfo.rows.map((r) => r[col]);

      // Align lengths conservatively
      const n = Math.min(xRaw.length, yRaw.length);
      const x = xRaw.slice(0, n);
      const y = yRaw.slice(0, n);

      const ds = downsampleXY(x, y, maxPoints);

      return {
        x: ds.x,
        y: ds.y,
        type: "scatter",
        mode: "lines",
        name: col,
      };
    });
  }, [fileInfo, timeCol, signalCols, maxPoints]);

  const canPlot = !!fileInfo && !!timeCol && signalCols.length > 0;

  return (
    <div className="app">
      <header className="header">
        <h1>iNav PID Analyzer</h1>
        <p>Upload an iNav Blackbox CSV and visualize Roll / Pitch / Yaw signals</p>
      </header>

      <main className="main">
        {/* Upload */}
        <section className="upload-card">
          <h2>Upload log file</h2>
          <p style={{ marginTop: 0, color: "#6b7280" }}>Supported format: Blackbox CSV export</p>

          <input type="file" accept=".csv" onChange={handleFileUpload} />

          {error && <p className="error">{error}</p>}

          {!fileInfo && !error && <p style={{ marginTop: 12 }}>No log loaded</p>}

          {fileInfo && (
            <div style={{ marginTop: 12 }}>
              <p>
                <strong>File:</strong> {fileInfo.name}
              </p>
              <p>
                <strong>Rows:</strong> {fileInfo.rows.length}
              </p>

              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={applyAutoDetected}>
                  Apply auto-detected columns
                </button>
              </div>

              <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
                <div><strong>Auto Time:</strong> {autoDetected.time || "(not found)"}</div>
                <div><strong>Auto Signals:</strong> {autoDetected.signals?.length ? autoDetected.signals.join(", ") : "(not found)"}</div>
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
            </div>
          )}
        </section>

        {/* Controls + plot */}
        <section className="empty-state">
          {!fileInfo && <p>Upload a CSV file to start analysis.</p>}

          {fileInfo && (
            <div style={{ width: "100%" }}>
              <h3>Signal selection</h3>

              {/* Time selector */}
              <div style={{ marginBottom: 12 }}>
                <label>
                  Time:&nbsp;
                  <select value={timeCol} onChange={(e) => setTimeCol(e.target.value)}>
                    <option value="">-- select --</option>
                    {fileInfo.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
                {!timeCol && (
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>
                    Couldn’t auto-detect time column — please select manually.
                  </div>
                )}
              </div>

              {/* Signal selector */}
              <div style={{ marginBottom: 20 }}>
                <label>
                  Signals (Roll / Pitch / Yaw):<br />
                  <select
                    multiple
                    style={{ width: "100%", height: 150 }}
                    value={signalCols}
                    onChange={(e) =>
                      setSignalCols(Array.from(e.target.selectedOptions).map((o) => o.value))
                    }
                  >
                    {fileInfo.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>

                {signalCols.length === 0 && (
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>
                    Couldn’t auto-detect gyro columns — please select manually.
                  </div>
                )}
              </div>

              {/* Plot */}
              {canPlot && (
                <Suspense fallback={<p>Loading chart…</p>}>
                  <Plot
                    data={plotData}
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
                </Suspense>
              )}

              {!canPlot && (
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  Select a time column and at least one signal to display the plot.
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
