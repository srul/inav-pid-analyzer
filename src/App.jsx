// STEP 14 — Firmware‑Aware Analyzer
import { useState } from "react";

const FIRMWARES = {
  ArduPilot: {
    notchEnable: "INS_HNTCH_ENABLE",
    notchFreq: "INS_HNTCH_FREQ",
    notchBW: "INS_HNTCH_BW",
    rateP: "ATC_RAT_RLL_P",
    rateI: "ATC_RAT_RLL_I",
  },
  iNav: {
    notchEnable: "gyro_notch1_enabled",
    notchFreq: "gyro_notch1_hz",
    notchBW: "gyro_notch1_cutoff",
    rateP: "roll_p",
    rateI: "roll_i",
  },
};

export default function App() {
  const [firmware, setFirmware] = useState("ArduPilot");

  return (
    <div style={{ padding: 20 }}>
      <h1>PID Analyzer — Step 14</h1>

      <label>
        Firmware:&nbsp;
        <select
          value={firmware}
          onChange={e => setFirmware(e.target.value)}
        >
          {Object.keys(FIRMWARES).map(f => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>

      <h3>Example Mapped Parameters</h3>
      <ul>
        <li>Enable Notch → {FIRMWARES[firmware].notchEnable}</li>
        <li>Notch Frequency → {FIRMWARES[firmware].notchFreq}</li>
        <li>Notch Bandwidth → {FIRMWARES[firmware].notchBW}</li>
        <li>Rate P → {FIRMWARES[firmware].rateP}</li>
        <li>Rate I → {FIRMWARES[firmware].rateI}</li>
      </ul>
    </div>
  );
}
