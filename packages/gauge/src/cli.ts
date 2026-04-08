import fs from 'node:fs';
import path from 'node:path';
import { expandSpec } from './expand';
import { StepRegistry } from './registry';

interface CliArgs {
  spec: string;
  steps: string;
  concepts?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--spec' && argv[i + 1]) {
      args.spec = argv[++i];
    } else if (arg === '--steps' && argv[i + 1]) {
      args.steps = argv[++i];
    } else if (arg === '--concepts' && argv[i + 1]) {
      args.concepts = argv[++i];
    }
  }
  if (!args.spec || !args.steps) {
    console.error('Usage: gauge-expand --spec <spec.md> --steps <steps-dir> [--concepts <concepts-dir>]');
    process.exit(1);
  }
  return args as CliArgs;
}

/**
 * Load step definition files by evaluating them.
 * Step files must use `defineStep()` from `@rstest/gauge` which registers to a global registry.
 * We build a StepRegistry by importing each file.
 */
async function loadSteps(stepsDir: string): Promise<StepRegistry> {
  const registry = new StepRegistry();

  if (!fs.existsSync(stepsDir)) {
    console.error(`Steps directory not found: ${stepsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(stepsDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

  for (const file of files) {
    const filePath = path.resolve(stepsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract defineStep calls via regex — good enough for code templates
    const stepRegex = /defineStep\(\s*'([^']+)'/g;
    let match: RegExpExecArray | null;
    while ((match = stepRegex.exec(content)) !== null) {
      const pattern = match[1]!;
      // Extract the template function body — find the arrow function after the pattern
      const afterPattern = content.slice(match.index + match[0].length);
      const templateMatch = afterPattern.match(/,\s*\([^)]*\)\s*=>\s*\n?\s*(`[\s\S]*?`|'[\s\S]*?'|\[[\s\S]*?\]\.join\([^)]*\))/);

      if (templateMatch) {
        // Store raw template string for output
        const rawTemplate = templateMatch[1]!;
        registry.register(pattern, (...args: string[]) => {
          // Simple template evaluation: replace JSON.stringify(paramN) with actual values
          let result = rawTemplate;
          // Replace ${JSON.stringify(paramName)} patterns
          for (let i = 0; i < args.length; i++) {
            result = result.replace(
              /\$\{JSON\.stringify\(\w+\)\}/,
              JSON.stringify(args[i]),
            );
            // Also replace simple ${paramName} patterns
            result = result.replace(/\$\{\w+\}/, args[i]!);
          }
          return result;
        });
      } else {
        // No-arg step
        const noArgMatch = afterPattern.match(/,\s*\(\)\s*=>\s*\n?\s*(`[\s\S]*?`|'[\s\S]*?')/);
        if (noArgMatch) {
          const rawTemplate = noArgMatch[1]!;
          registry.register(pattern, () => rawTemplate.slice(1, -1));
        }
      }
    }
  }

  return registry;
}

function loadConcepts(conceptsDir: string): string[] {
  if (!conceptsDir || !fs.existsSync(conceptsDir)) {
    return [];
  }
  return fs
    .readdirSync(conceptsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.resolve(conceptsDir, f), 'utf-8'));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const specContent = fs.readFileSync(args.spec, 'utf-8');
  const registry = await loadSteps(args.steps);
  const conceptFiles = loadConcepts(args.concepts ?? '');

  try {
    const result = expandSpec({
      spec: specContent,
      registry,
      conceptFiles,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Expansion failed:', (err as Error).message);
    process.exit(1);
  }
}

main();
