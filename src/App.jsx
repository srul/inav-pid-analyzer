import { useState } from 'react';
import './App.css';

function App() {
  const [fileInfo, setFileInfo] = useState(null);
  const [error, setError] = useState(null);

  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file');
      setFileInfo(null);
      return;
    }

    setError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const lines = text.split('\n').filter(Boolean);
      const header = lines[0].split(',');

      setFileInfo({
        name: file.name,
        sizeKb: Math.round(file.size / 1024),
        rows: lines.length - 1,
        columns: header,
      });
    };

    reader.readAsText(file);
  }

  return (
    <div className="app">
      <header className="header">
        <h1>iNav PID Analyzer</h1>
        <p>Upload an iNav Blackbox CSV and get PID insights</p>
      </header>

      <main className="main">
        <section className="upload-card">
          <h2>Upload log file</h2>
          <p>Supported format: Blackbox CSV</p>

          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
          />

          {error && <p className="error">{error}</p>}

          {fileInfo && (
            <div className="file-info">
              <p><strong>File:</strong> {fileInfo.name}</p>
              <p><strong>Size:</strong> {fileInfo.sizeKb} KB</p>
              <p><strong>Rows:</strong> {fileInfo.rows}</p>
            </div>
          )}
        </section>

        <section className="empty-state">
          {!fileInfo ? (
            <p>No log loaded yet.<br />Upload a file to start analysis.</p>
          ) : (
            <div>
              <h3>Detected columns</h3>
              <ul>
                {fileInfo.columns.slice(0, 15).map((col) => (
                  <li key={col}>{col}</li>
                ))}
              </ul>
