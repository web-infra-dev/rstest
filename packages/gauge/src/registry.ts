import type { CodeTemplate, StepDefinition } from './types';

const PARAM_PATTERN = /<(\w+)>/g;

/**
 * Escape regex special characters, except for <param> placeholders
 * which are handled separately.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a step pattern like `Create file <filename> with <content>`
 * into a regex that captures quoted arguments.
 *
 * The resulting regex expects each parameter to be wrapped in double quotes
 * in the spec text: `Create file "hello.ts" with "console.log('hi')"`
 */
export function patternToRegex(pattern: string): {
  regex: RegExp;
  paramNames: string[];
} {
  const paramNames: string[] = [];

  // Split pattern around <param> tokens so we can escape literal parts
  // while replacing params with capture groups.
  const parts = pattern.split(PARAM_PATTERN);
  let regexStr = '^';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i % 2 === 0) {
      // Literal text between params
      regexStr += escapeRegex(part);
    } else {
      // Parameter name — replace with quoted capture group
      paramNames.push(part);
      regexStr += '"(.*?)"';
    }
  }

  regexStr += '$';
  return { regex: new RegExp(regexStr), paramNames };
}

export class StepRegistry {
  private steps: StepDefinition[] = [];

  register(pattern: string, template: CodeTemplate): void {
    const { regex, paramNames } = patternToRegex(pattern);
    this.steps.push({ pattern, paramNames, regex, template });
  }

  /** Return all registered patterns (for validation / listing) */
  getPatterns(): string[] {
    return this.steps.map((s) => s.pattern);
  }

  /**
   * Match step text against registered patterns.
   * Returns the first match with extracted args, or null.
   */
  match(
    stepText: string,
  ): { definition: StepDefinition; args: Record<string, string> } | null {
    for (const def of this.steps) {
      const m = stepText.match(def.regex);
      if (m) {
        const args: Record<string, string> = {};
        for (let i = 0; i < def.paramNames.length; i++) {
          args[def.paramNames[i]!] = m[i + 1] ?? '';
        }
        return { definition: def, args };
      }
    }
    return null;
  }

  /**
   * Expand a step text into a code snippet.
   * Throws if no matching pattern is found.
   */
  expand(stepText: string): {
    pattern: string;
    args: Record<string, string>;
    code: string;
  } {
    const result = this.match(stepText);
    if (!result) {
      throw new Error(`No matching step definition for: "${stepText}"`);
    }
    const { definition, args } = result;
    const orderedArgs = definition.paramNames.map((name) => args[name] ?? '');
    const code = definition.template(...orderedArgs);
    return { pattern: definition.pattern, args, code };
  }
}

/** Global registry used by defineStep */
let globalRegistry: StepRegistry | null = null;

export function getGlobalRegistry(): StepRegistry {
  if (!globalRegistry) {
    globalRegistry = new StepRegistry();
  }
  return globalRegistry;
}

export function resetGlobalRegistry(): void {
  globalRegistry = null;
}

/**
 * Register a step definition in the global registry.
 *
 * @example
 * ```ts
 * defineStep('Create file <filename> with <content>', (filename, content) =>
 *   `fs.writeFileSync(${JSON.stringify(filename)}, ${JSON.stringify(content)})`
 * )
 * ```
 */
export function defineStep(pattern: string, template: CodeTemplate): void {
  getGlobalRegistry().register(pattern, template);
}
