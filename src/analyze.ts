import { AnalysisMode, Severity, ConfidenceLevel } from "./types/enums";
import { AnalysisResult } from "./types/analysis-result";
import { RuleResult } from "./types/rule-result";
import { PidConfig } from "./types/pid-config";
import { LogAnalysis } from "./types/log-analysis";

const DEFAULT_WARN_RATIO = 2.5;
const DEFAULT_CRIT_RATIO = 5.0;

export function analyze(input: {
  pidConfig?: PidConfig;
  logAnalysis?: LogAnalysis;
  vibWarnRatio?: number;
  vibCritRatio?: number;
}): AnalysisResult {

  const mode: AnalysisMode =
    input.pidConfig && input.logAnalysis ? AnalysisMode.COMBINED :
    input.pidConfig ? AnalysisMode.SCREENSHOT_ONLY :
    AnalysisMode.LOG_ONLY;

  const warnR = input.vibWarnRatio ?? DEFAULT_WARN_RATIO;
  const critR = input.vibCritRatio ?? DEFAULT_CRIT_RATIO;

  const rules: RuleResult[] = [];

  // ---------------- Screenshot (config) rules ----------------
  if (input.pidConfig) {
    rules.push(...evaluatePidConfigRules(input.pidConfig));
  }

  // ---------------- Log rules ----------------
  if (input.logAnalysis) {
    rules.push(...evaluateLogRules(input.logAnalysis, warnR, critR));
  }

  // ---------------- Severity resolution ----------------
  let severity = maxSeverity(rules);

  // Hard rule: screenshot-only cannot be CRITICAL
  if (mode === AnalysisMode.SCREENSHOT_ONLY && severity === Severity.CRITICAL) {
    severity = Severity.WARNING;
  }

  // Combined conflict: config risky, log clean -> INFO (trust rule)
  if (
    mode === AnalysisMode.COMBINED &&
    rules.some(r => r.message.includes("CONFIG:")) &&
    !rules.some(r => r.message.includes("LOG:") && r.severity >= Severity.WARNING)
  ) {
    severity = Severity.INFO;
  }

  const confidence = resolveConfidence(mode, input.pidConfig, input.logAnalysis);

  return {
    mode,
    severity,
    confidence,
    summaryTitle: titleFor(mode, severity),
    summarySubtitle: subtitleFor(mode),
    rulesTriggered: rules
  };
}

// ================= RULES =================

function evaluatePidConfigRules(cfg: PidConfig): RuleResult[] {
  const out: RuleResult[] = [];

  const r = cfg.axes.roll;
  const p = cfg.axes.pitch;
  const y = cfg.axes.yaw;

  // R3: Roll vs Pitch P imbalance > 25%
  if (isFiniteNum(r.P) && isFiniteNum(p.P)) {
    const diff = Math.abs((p.P as number) - (r.P as number));
    const base = Math.min((p.P as number), (r.P as number));
    if (base > 0 && diff / base > 0.25) {
      out.push({
        severity: Severity.WARNING,
        message: "CONFIG: Pitch P is significantly higher than Roll P",
        suggestion: "If no airframe-specific reason exists, align Pitch P closer to Roll P"
      });
    }
  }

  // R5: High P / low D ratio (per axis)
  out.push(...highPtoDRatio("roll", r));
  out.push(...highPtoDRatio("pitch", p));
  out.push(...missingD("yaw", y));

  return out;
}

function highPtoDRatio(axis: "roll"|"pitch"|"yaw", v: {P?:number; D?:number}): RuleResult[] {
  if (!isFiniteNum(v.P) || !isFiniteNum(v.D)) return [];
  const P = v.P as number;
  const D = v.D as number;
  if (P <= 0) return [];

  const ratio = D / P;
  if (ratio < 0.15) {
    return [{
      severity: Severity.WARNING,
      message: `CONFIG: ${axis.toUpperCase()} P is aggressive relative to D`,
      suggestion: `If oscillation is observed, reduce ${axis} P by ~10% or increase D slightly`
    }];
  }
  return [];
}

function missingD(axis: "roll"|"pitch"|"yaw", v: {P?:number; D?:number}): RuleResult[] {
  // If D is explicitly 0 and P exists -> INFO (config-only)
  if (isFiniteNum(v.P) && v.D === 0) {
    return [{
      severity: Severity.INFO,
      message: `CONFIG: ${axis.toUpperCase()} D appears minimal or zero`,
      suggestion: `If bounce-back or overshoot is observed on ${axis}, add a small amount of D`
    }];
  }
  return [];
}

function evaluateLogRules(log: LogAnalysis, warnR: number, critR: number): RuleResult[] {
  const out: RuleResult[] = [];

  // Find max peakRatio across axes
  const peaks = log.fftPeaks ?? {};
  const ratios: number[] = [];
  for (const k of ["roll","pitch","yaw"] as const) {
    const pr = peaks[k]?.peakRatio;
    if (typeof pr === "number" && Number.isFinite(pr)) ratios.push(pr);
  }

  if (!ratios.length) return out;

  const maxRatio = Math.max(...ratios);

  if (maxRatio >= critR) {
    out.push({
      severity: Severity.CRITICAL,
      message: `LOG: FFT indicates strong resonance (peakRatio ${maxRatio.toFixed(2)}×)`,
      suggestion: "Enable or retune notch filtering around the dominant vibration peak"
    });
  } else if (maxRatio >= warnR) {
    out.push({
      severity: Severity.WARNING,
      message: `LOG: FFT indicates notable vibration (peakRatio ${maxRatio.toFixed(2)}×)`,
      suggestion: "Consider notch filtering and verify mechanical vibration sources"
    });
  } else {
    out.push({
      severity: Severity.INFO,
      message: `LOG: FFT does not show strong resonance (peakRatio ${maxRatio.toFixed(2)}×)`,
      suggestion: "No strong vibration signature detected in this log window"
    });
  }

  return out;
}

// ================= RESOLUTION HELPERS =================

function maxSeverity(rules: RuleResult[]): Severity {
  if (rules.some(r => r.severity === Severity.CRITICAL)) return Severity.CRITICAL;
  if (rules.some(r => r.severity === Severity.WARNING)) return Severity.WARNING;
  if (rules.some(r => r.severity === Severity.INFO)) return Severity.INFO;
  return Severity.OK;
}

function resolveConfidence(
  mode: AnalysisMode,
  cfg?: PidConfig,
  log?: LogAnalysis
): ConfidenceLevel {

  // Logs are ground truth
  if (mode === AnalysisMode.LOG_ONLY) return ConfidenceLevel.HIGH;
  if (mode === AnalysisMode.COMBINED) return ConfidenceLevel.HIGH;

  // Screenshot-only logic
  if (!cfg) return ConfidenceLevel.LOW;

  const axes = [cfg.axes.roll, cfg.axes.pitch, cfg.axes.yaw];

  let fullCount = 0;
  let partialCount = 0;

  for (const a of axes) {
    const hasP = typeof a.P === "number";
    const hasI = typeof a.I === "number";
    const hasD = typeof a.D === "number";

    if (hasP && hasI && hasD) {
      fullCount++;
    } else if (hasP || hasI || hasD) {
      partialCount++;
    }
  }

  // 3 full axes → HIGH confidence
  if (fullCount === 3) return ConfidenceLevel.HIGH;

  // Some signal but incomplete
  if (fullCount + partialCount >= 2) return ConfidenceLevel.MEDIUM;

  // Weak config basis
  return ConfidenceLevel.LOW;
}


function titleFor(mode: AnalysisMode, sev: Severity): string {
  if (mode === AnalysisMode.LOG_ONLY) {
    if (sev === Severity.CRITICAL) return "High-frequency oscillation detected";
    if (sev === Severity.WARNING) return "Vibration risk detected";
    return "No major vibration issues detected";
  }
  if (mode === AnalysisMode.COMBINED) {
    if (sev === Severity.CRITICAL) return "Confirmed high-frequency oscillation detected";
    if (sev === Severity.WARNING) return "Configuration and log suggest tuning risk";
    return "Configuration risk not confirmed by log";
  }
  // screenshot-only
  if (sev === Severity.WARNING) return "PID configuration suggests potential tuning issues";
  if (sev === Severity.INFO) return "PID configuration shows minor deviations";
  return "PID configuration looks reasonable";
}

function subtitleFor(mode: AnalysisMode): string {
  if (mode === AnalysisMode.LOG_ONLY) return "Based on measured flight behavior";
  if (mode === AnalysisMode.COMBINED) return "Configuration and flight data are consistent";
  return "Based on controller configuration (no flight data)";
}

function isFiniteNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
