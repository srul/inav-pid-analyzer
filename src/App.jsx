import { useState } from "react";

export default function App() {
  const [fileName, setFileName] = useState("");

  function onFile(e) {
    const f = e.target.files?.[0];
    if (f) setFileName(f.name);
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Baseline</h1>

      <input type="file" accept=".csv,.txt" onChange={onFile} />

      {fileName && (
        <p style={{ marginTop: 10 }}>
          Loaded file: <b>{fileName}</b>
        </p>
      )}
    </div>
  );
}
