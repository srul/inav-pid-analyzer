import { analyze } from "../src/analyze";
import { AnalysisMode, Severity } from "../src/types/enums";

describe("PID Analyzer – real PID values tests", () => {

  test("Screenshot-only WARNING: Pitch P is >25% higher than Roll P", () => {
    const result = analyze({
      pidConfig: {
        firmware: "iNav",
        loop: "rate",
        axes: {
          roll:  { P: 45, I: 60, D: 12 },
          pitch: { P: 62, I: 70, D: 10 },
          yaw:   { P: 80, I: 85, D: 0 }
        },
        axisConfidence: { roll: 0.9, pitch: 0.9, yaw: 0.9 }
      }
    });

    expect(result.mode).toBe(AnalysisMode.SCREENSHOT_ONLY);
    expect(result.severity).toBe(Severity.WARNING);
  });

  test("Screenshot-only never returns CRITICAL (even if D/P is tiny)", () => {
    const result = analyze({
      pidConfig: {
        firmware: "iNav",
        loop: "rate",
        axes: {
          roll:  { P: 100, I: 60, D: 1 },     // D/P = 0.01 (would be bad)
          pitch: { P: 100, I: 60, D: 1 },
          yaw:   { P: 50, I: 50, D: 0 }
        }
      }
    });

    expect(result.mode).toBe(AnalysisMode.SCREENSHOT_ONLY);
    expect(result.severity).not.toBe(Severity.CRITICAL);
  });

  test("Log-only can return CRITICAL when peakRatio >= crit threshold", () => {
    const result = analyze({
      logAnalysis: {
        fftPeaks: {
          roll: { freqHz: 92, peakRatio: 6.1 }
        }
      },
      vibWarnRatio: 2.5,
      vibCritRatio: 5.0
    });

    expect(result.mode).toBe(AnalysisMode.LOG_ONLY);
    expect(result.severity).toBe(Severity.CRITICAL);
  });

  test("Combined: config warning + log clean downgrades to INFO", () => {
    const result = analyze({
      pidConfig: {
        firmware: "iNav",
        loop: "rate",
        axes: {
          roll:  { P: 45, I: 60, D: 12 },
          pitch: { P: 62, I: 70, D: 10 }, // imbalance triggers config warning
          yaw:   { P: 80, I: 85, D: 0 }
        }
      },
      logAnalysis: {
        fftPeaks: {
          roll: { freqHz: 90, peakRatio: 1.2 } // below warn threshold
        }
      },
      vibWarnRatio: 2.5,
      vibCritRatio: 5.0
    });

    expect(result.mode).toBe(AnalysisMode.COMBINED);
    expect(result.severity).toBe(Severity.INFO);
  });

});
test("Screenshot-only confidence HIGH when all axes have P/I/D", () => {
  const result = analyze({
    pidConfig: {
      firmware: "iNav",
      loop: "rate",
      axes: {
        roll:  { P: 40, I: 60, D: 14 },
        pitch: { P: 42, I: 65, D: 13 },
        yaw:   { P: 55, I: 70, D: 10 }
      }
    }
  });

  expect(result.confidence).toBe("HIGH");
});

test("Screenshot-only confidence MEDIUM when some D values are missing", () => {
  const result = analyze({
    pidConfig: {
      firmware: "iNav",
      loop: "rate",
      axes: {
        roll:  { P: 40, I: 60 },
        pitch: { P: 42, I: 65 },
        yaw:   { P: 55 }
      }
    }
  });

  expect(result.confidence).toBe("MEDIUM");
});

test("Screenshot-only confidence LOW when PID data is very incomplete", () => {
  const result = analyze({
    pidConfig: {
      firmware: "iNav",
      loop: "rate",
      axes: {
        roll:  { },
        pitch: { P: 42 },
        yaw:   { }
      }
    }
  });

  expect(result.confidence).toBe("LOW");
});