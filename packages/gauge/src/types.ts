/** Function that produces a code snippet from extracted step parameters */
export type CodeTemplate = (...args: string[]) => string;

export interface StepDefinition {
  /** Original pattern string, e.g. "Create file <filename> with <content>" */
  pattern: string;
  /** Parameter names extracted from <placeholders> */
  paramNames: string[];
  /** Compiled regex for matching step text */
  regex: RegExp;
  /** Template function that produces code from matched args */
  template: CodeTemplate;
}

export interface Step {
  /** Raw step text from the spec */
  text: string;
}

export interface Scenario {
  name: string;
  steps: Step[];
}

export interface Spec {
  name: string;
  scenarios: Scenario[];
}

export interface ConceptDefinition {
  /** Pattern with <param> placeholders */
  pattern: string;
  paramNames: string[];
  regex: RegExp;
  /** Atomic steps this concept expands into (may contain <param> refs) */
  steps: string[];
}

export interface ExpandedStep {
  /** Original step text */
  step: string;
  /** Matched pattern */
  pattern: string;
  /** Extracted arguments keyed by param name */
  args: Record<string, string>;
  /** Generated code snippet */
  code: string;
}

export interface ExpandedScenario {
  name: string;
  fragments: ExpandedStep[];
}

export interface ExpandedSpec {
  name: string;
  scenarios: ExpandedScenario[];
}
