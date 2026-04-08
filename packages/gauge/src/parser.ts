import type { ConceptDefinition, Scenario, Spec, Step } from './types';
import { patternToRegex } from './registry';

/**
 * Parse a Gauge-like Markdown spec into a structured Spec object.
 *
 * Format:
 * ```markdown
 * # Spec Name
 *
 * ## Scenario Name
 *
 * * step text with "param1" and "param2"
 * * another step
 * ```
 */
export function parseSpec(markdown: string): Spec {
  const lines = markdown.split('\n');

  let specName = '';
  const scenarios: Scenario[] = [];
  let currentScenario: Scenario | null = null;

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith('# ') && !line.startsWith('## ')) {
      specName = line.slice(2).trim();
    } else if (line.startsWith('## ')) {
      currentScenario = { name: line.slice(3).trim(), steps: [] };
      scenarios.push(currentScenario);
    } else if (line.startsWith('* ') && currentScenario) {
      currentScenario.steps.push({ text: line.slice(2).trim() });
    }
  }

  if (!specName) {
    throw new Error('Spec must have a title (# Title)');
  }

  return { name: specName, scenarios };
}

/**
 * Parse a Gauge concept file.
 *
 * Format:
 * ```markdown
 * # Concept pattern with <param>
 *
 * * atomic step using <param>
 * * another atomic step
 * ```
 *
 * A single file can contain multiple concepts separated by `#` headings.
 */
export function parseConcepts(markdown: string): ConceptDefinition[] {
  const lines = markdown.split('\n');
  const concepts: ConceptDefinition[] = [];

  let currentPattern: string | null = null;
  let currentSteps: string[] = [];

  function flush(): void {
    if (currentPattern) {
      const { regex, paramNames } = patternToRegex(currentPattern);
      concepts.push({
        pattern: currentPattern,
        paramNames,
        regex,
        steps: currentSteps,
      });
    }
  }

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith('# ') && !line.startsWith('## ')) {
      flush();
      currentPattern = line.slice(2).trim();
      currentSteps = [];
    } else if (line.startsWith('* ') && currentPattern) {
      currentSteps.push(line.slice(2).trim());
    }
  }

  flush();
  return concepts;
}

/**
 * Expand concepts in a list of steps.
 * When a step matches a concept, it is replaced with the concept's
 * atomic steps (with parameters substituted).
 *
 * Supports nested concepts via recursive expansion (with depth limit).
 */
export function expandConcepts(
  steps: Step[],
  concepts: ConceptDefinition[],
  maxDepth = 10,
): Step[] {
  function expand(step: Step, depth: number): Step[] {
    if (depth > maxDepth) {
      throw new Error(
        `Concept expansion exceeded max depth (${maxDepth}). Circular reference?`,
      );
    }

    for (const concept of concepts) {
      const m = step.text.match(concept.regex);
      if (m) {
        // Extract args from the match
        const args: Record<string, string> = {};
        for (let i = 0; i < concept.paramNames.length; i++) {
          args[concept.paramNames[i]!] = m[i + 1] ?? '';
        }

        // Substitute params into concept's atomic steps
        const expandedSteps = concept.steps.map((stepText) => {
          let substituted = stepText;
          for (const [name, value] of Object.entries(args)) {
            substituted = substituted.replaceAll(`<${name}>`, `"${value}"`);
          }
          return { text: substituted };
        });

        // Recursively expand in case of nested concepts
        return expandedSteps.flatMap((s) => expand(s, depth + 1));
      }
    }

    // No concept match — return as-is
    return [step];
  }

  return steps.flatMap((step) => expand(step, 0));
}
