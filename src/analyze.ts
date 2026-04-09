import { AnalysisMode, Severity } from "./types/enums";

export function analyze(input: {
  pidScreenshot?: string;
  flightLog?: string;
}) {
  const mode =
    input.pidScreenshot && input.flightLog
      ? AnalysisMode.COMBINED
      : input.pidScreenshot
      ? AnalysisMode.SCREENSHOT_ONLY
      : AnalysisMode.LOG_ONLY;

  // Default
  let severity = Severity.OK;

  // Screenshot logic
  if (input.pidScreenshot) {
    if (input.pidScreenshot.includes("warning")) {
      severity = Severity.WARNING;
    }
  }

  // Log logic (can escalate to CRITICAL)
  if (input.flightLog) {
    if (input.flightLog.includes("critical")) {
      severity = Severity.CRITICAL;
    }
  }

  // Safety rule: screenshot-only can never be CRITICAL
  if (mode === AnalysisMode.SCREENSHOT_ONLY && severity === Severity.CRITICAL) {
    severity = Severity.WARNING;
  }

  // Combined conflict rule
  if (
    mode === AnalysisMode.COMBINED &&
    input.pidScreenshot?.includes("warning") &&
    input.flightLog?.includes("clean")
  ) {
    severity = Severity.INFO;
  }

  return {
    mode,
    severity,
    confidence: "MEDIUM",
    summaryTitle: "PID Analysis",
    summarySubtitle: "Test result",
    rulesTriggered: []
  };
}