import { useState } from 'react';
import './App.css';

export default function App() {
  const [fileInfo, setFileInfo] = useState(null);

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split('\n').filter(Boolean);
      const columns = lines[0].split(',');

      setFileInfo({
        name: file.name,
        rows: lines.length - 1,
        columns,
      });
    };
    reader.readAsText(file);
  }

  return (
    <div className="app">
      <h1>iNav PID Analyzer</h1>

      <input type="file" accept=".csv" onChange={handleFileUpload} />

      {!fileInfo && <p>No log loaded</p>}

      {fileInfo && (
        <div>
          <p><b>File:</b> {fileInfo.name}</p>
          <p><b>Rows:</b> {fileInfo.rows}</p>

          <ul>
            {fileInfo.columns.slice(0, 10).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
