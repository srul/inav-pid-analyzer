import { AnalysisMode, Severity, ConfidenceLevel } from "./enums";
import { RuleResult } from "./rule-result";

export interface AnalysisResult {
  mode: AnalysisMode;
  severity: Severity;
  confidence: ConfidenceLevel;
  summaryTitle: string;
  summarySubtitle: string;
  rulesTriggered: RuleResult[];
}