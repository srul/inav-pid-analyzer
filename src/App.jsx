import { useState } from "react";

export default function App() {
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("No file loaded");

  function loadFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setStatus("File loaded successfully ✅");
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 1 (Text Only)</h1>

      <p>
        If you see this text, React is working correctly.
      </p>

      <input type="file" accept=".csv,.txt" onChange={loadFile} />

      <div style={{ marginTop: 15 }}>
        <b>Status:</b> {status}
      </div>

      {fileName && (
        <div>
          <b>File name:</b> {fileName}
        </div>
      )}
    </div>
  );
}
