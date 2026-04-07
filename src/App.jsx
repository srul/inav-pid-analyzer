import { useState } from 'react';
import './App.css';
import Plot from 'react-plotly.js';

export default function App() {
  const [fileInfo, setFileInfo] = useState(null);
  const [timeCol, setTimeCol] = useState('');
  const [signalCols, setSignalCols] = useState([]);


  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
  
    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split('\n').filter(Boolean);
      const headers = lines[0].split(',');
  
      const rows = lines.slice(1).map((line) => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((h, i) => {
          const v = values[i];
          obj[h] = isNaN(v) ? v : Number(v);
        });
      return obj;
    });

    setFileInfo({
      name: file.name,
      headers,
      rows,
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
      
{fileInfo && (
  <div style={{ marginTop: 20 }}>
    <h3>Signal selection</h3>

    <label>
      Time:
      <select value={timeCol} onChange={(e) => setTimeCol(e.target.value)}>
        <option value="">-- select --</option>
        {fileInfo.headers.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
    </label>

    <br /><br />

    <label>
      Signals (Roll / Pitch / Yaw):
      <select
        multiple
        value={signalCols}
        onChange={(e) =>
          setSignalCols([...e.target.selectedOptions].map(o => o.value))
        }
        style={{ height: 120 }}
      >
        {fileInfo.headers.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
    </label>
  </div>
)}
{fileInfo && timeCol && signalCols.length > 0 && (
  <Plot
    data={signalCols.map((col) => ({
      x: fileInfo.rows.map(r => r[timeCol]),
      y: fileInfo.rows.map(r => r[col]),
      type: 'scatter',
      mode: 'lines',
      name: col,
    }))}
    layout={{
      title: 'iNav Signal Plot',
      xaxis: { title: timeCol },
      yaxis: { title: 'Value' },
      legend: { orientation: 'h' },
      margin: { t: 40 },
    }}
    style={{ width: '100%', height: '500px' }}
  />
)}
    </div>
  );
}
