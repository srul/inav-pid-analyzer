import { Severity } from "./enums";

export interface RuleResult {
  severity: Severity;
  message: string;
  suggestion?: string;
}