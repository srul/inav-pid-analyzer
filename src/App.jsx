import { useState } from "react";

export default function App() {
  const [info, setInfo] = useState(null);
  const [rows, setRows] = useState([]);
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

        // detect delimiter
        let delimiter = ",";
        if (lines[0].includes("\t")) delimiter = "\t";
        else if (lines[0].includes(";")) delimiter = ";";

        const headers = lines[0].split(delimiter).map(h => h.trim());

        const timeIdx = headers.indexOf("time");
        const gyroIdx = headers.indexOf("gyro[0]");
        if (timeIdx === -1 || gyroIdx === -1) {
          throw new Error(`Missing required columns. Found: ${headers.join(", ")}`);
        }

        const parsed = lines.slice(1)
          .map(line => {
            const parts = line.split(delimiter);
            return {
              time: Number(parts[timeIdx]),
              gyro: Number(parts[gyroIdx])
            };
          })
          .filter(r => Number.isFinite(r.time) && Number.isFinite(r.gyro));

        if (parsed.length === 0) {
          throw new Error("No numeric rows found");
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

  // SVG helpers
  function makePath(data, w, h, pad) {
    const xs = data.map(d => d.time);
    const ys = data.map(d => d.gyro);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return data.map((d, i) => {
      const x = pad + ((d.time - minX) / (maxX - minX)) * (w - 2 * pad);
      const y = h - pad - ((d.gyro - minY) / (maxY - minY)) * (h - 2 * pad);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    }).join(" ");
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 3 (First Plot)</h1>

      <input type="file" accept=".csv,.txt" onChange={loadFile} />

      {error && <div style={{ color: "red", marginTop: 10 }}>❌ {error}</div>}

      {info && (
        <div style={{ marginTop: 10 }}>
          <b>File:</b> {info.name} <br />
          <b>Rows:</b> {info.rows}
        </div>
      )}

      {rows.length > 0 && (
        <svg
          width={800}
          height={300}
          style={{
            marginTop: 20,
            border: "1px solid #ccc",
            background: "#fafafa"
          }}
        >
          <path
            d={makePath(rows, 800, 300, 30)}
            fill="none"
            stroke="#0070f3"
            strokeWidth="2"
          />
        </svg>
      )}
    </div>
  );
}
