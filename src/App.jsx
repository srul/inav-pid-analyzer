import './App.css';

function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>iNav PID Analyzer</h1>
        <p>
          Upload an iNav 9.x Blackbox CSV and get PID insights
        </p>
      </header>

      <main className="main">
        <section className="upload-card">
          <h2>Upload log file</h2>
          <p>Supported format: Blackbox CSV</p>

          {/* Placeholder – we’ll make this real in step 2 */}
          <input type="file" disabled />
        </section>

        <section className="empty-state">
          <p>
            No log loaded yet.<br />
            Upload a file to start analysis.
          </p>
        </section>
      </main>

      <footer className="footer">
        <span>Beta • iNav 9.x</span>
      </footer>
    </div>
  );
}

export default App;
