import type {
  ConceptDefinition,
  ExpandedSpec,
  ExpandedStep,
} from './types';
import { expandConcepts, parseConcepts, parseSpec } from './parser';
import { StepRegistry } from './registry';

export interface ExpandOptions {
  /** Gauge-like Markdown spec content */
  spec: string;
  /** Step registry with registered step definitions */
  registry: StepRegistry;
  /** Optional concept file contents (each string is a concept file) */
  conceptFiles?: string[];
}

/**
 * End-to-end pipeline: parse spec → expand concepts → match steps → produce code fragments.
 *
 * Returns a structured ExpandedSpec with code snippets for each step,
 * ready for agent assembly into a .test.ts file.
 */
export function expandSpec(options: ExpandOptions): ExpandedSpec {
  const { spec, registry, conceptFiles = [] } = options;

  // 1. Parse concepts from all concept files
  const concepts: ConceptDefinition[] = conceptFiles.flatMap(parseConcepts);

  // 2. Parse the spec
  const parsed = parseSpec(spec);

  // 3. For each scenario, expand concepts then expand steps
  const scenarios = parsed.scenarios.map((scenario) => {
    // Expand concepts into atomic steps
    const atomicSteps = expandConcepts(scenario.steps, concepts);

    // Expand each step through the registry
    const fragments: ExpandedStep[] = atomicSteps.map((step) => {
      const result = registry.expand(step.text);
      return {
        step: step.text,
        pattern: result.pattern,
        args: result.args,
        code: result.code,
      };
    });

    return { name: scenario.name, fragments };
  });

  return { name: parsed.name, scenarios };
}
