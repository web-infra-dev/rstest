import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import { PlanInputSchema } from './schema';
import type { DebugResult, Plan, RunnerConfig, TaskDefinition } from './types';

// ============================================================================
// CLI Options
// ============================================================================

export type CliOptions = {
  planPath?: string;
  outputPath?: string;
  breakpointTimeout?: number;
  inactivityTimeout?: number;
  debug: boolean;
};

const readStringOption = (
  options: Record<string, unknown>,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
  }
  return undefined;
};

const readBooleanOption = (
  options: Record<string, unknown>,
  keys: string[],
): boolean => {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'boolean') return value;
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
  }
  return false;
};

const readNumberOption = (
  options: Record<string, unknown>,
  keys: string[],
): number | undefined => {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
};

export const parseCliOptions = (
  options: Record<string, unknown>,
): CliOptions => ({
  planPath: readStringOption(options, ['plan', 'p']),
  outputPath: readStringOption(options, ['output']),
  breakpointTimeout: readNumberOption(options, ['breakpointTimeout']),
  inactivityTimeout: readNumberOption(options, ['inactivityTimeout']),
  debug: readBooleanOption(options, ['debug']),
});

// ============================================================================
// Plan Loading
// ============================================================================

const readStdin = async (): Promise<string> => {
  return new Promise((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolve(buffer));
    process.stdin.on('error', reject);
  });
};

export const loadPlan = async (planPath?: string): Promise<Plan> => {
  if (!planPath) {
    throw new Error('Missing required --plan <path>');
  }
  const content =
    planPath === '-'
      ? await readStdin()
      : await fs.promises.readFile(path.resolve(planPath), 'utf-8');
  if (!content.trim()) {
    throw new Error(
      planPath === '-'
        ? 'Empty plan received on stdin.'
        : 'Plan file is empty.',
    );
  }
  const parsed = v.safeParse(PlanInputSchema, JSON.parse(content) as unknown);
  if (!parsed.success) {
    const messages = (
      parsed.issues as Array<{
        message?: string;
        path?: Array<{ key?: string | number }>;
      }>
    )
      .map((issue) => {
        const keyPath = (issue.path ?? [])
          .map((item) => item?.key)
          .filter(
            (key): key is string | number =>
              typeof key === 'string' || typeof key === 'number',
          )
          .map(String)
          .join('.');
        const message = issue.message ?? 'Invalid value.';
        return keyPath ? `${keyPath}: ${message}` : message;
      })
      .filter(Boolean);

    throw new Error(
      messages.length
        ? `Invalid plan schema.\n${messages.join('\n')}`
        : 'Invalid plan schema.',
    );
  }

  return normalizePlan(parsed.output);
};

const normalizePlan = (plan: v.InferOutput<typeof PlanInputSchema>): Plan => {
  const runner: RunnerConfig = {
    cmd: plan.runner.cmd,
    args: [...plan.runner.args],
    cwd: plan.runner.cwd,
    env: plan.runner.env ?? {},
  };

  const tasks: TaskDefinition[] = plan.tasks.map(
    (task: (typeof plan.tasks)[number], index: number) => {
      const providedId = typeof task.id === 'string' ? task.id.trim() : '';
      const id = providedId || `task-${index + 1}`;
      return {
        ...task,
        id,
        // Derived defaults.
        order: Number.isFinite(task.order) ? task.order : index,
        hits: Number.isFinite(task.hits) ? task.hits : 0,
      };
    },
  );

  return { runner, tasks };
};

// ============================================================================
// Runner Args Normalization
// ============================================================================

export type NormalizedRunnerArgs = { args: string[]; error?: string };

/**
 * Normalize runner args to ensure:
 * - Exactly one `--include <file>` is present
 * - Debug-related flags are stripped (will be re-added with correct values)
 * - Single worker mode is enforced for deterministic debugging
 */
export const normalizeRunnerArgs = (args: string[]): NormalizedRunnerArgs => {
  const normalized: string[] = [];
  let includeCount = 0;

  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (!value) continue;

    // Count --include occurrences
    if (value === '--include') {
      const next = args[i + 1];
      if (!next || next.startsWith('-')) {
        return {
          args: normalized,
          error: 'Runner args must include exactly one "--include <file>".',
        };
      }
      includeCount += 1;
      normalized.push(value, next);
      i += 1;
      continue;
    }
    if (value.startsWith('--include=')) {
      includeCount += 1;
      normalized.push(value);
      continue;
    }

    // Strip flags that will be overridden
    if (
      value === '--pool.maxWorkers' ||
      value === '--pool.execArgv' ||
      value === '--maxWorkers'
    ) {
      i += 1; // Skip next argument (the value)
      continue;
    }
    if (
      value.startsWith('--pool.maxWorkers=') ||
      value.startsWith('--pool.execArgv=') ||
      value.startsWith('--maxWorkers=')
    ) {
      continue;
    }

    // Strip inspect flags (will use --inspect-brk=0 via pool.execArgv)
    if (value === '--inspect' || value === '--inspect-brk') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) i += 1;
      continue;
    }
    if (value.startsWith('--inspect=') || value.startsWith('--inspect-brk=')) {
      continue;
    }

    normalized.push(value);
  }

  if (includeCount !== 1) {
    return {
      args: normalized,
      error:
        includeCount === 0
          ? 'Runner args must include exactly one "--include <file>".'
          : 'Runner args must include exactly one "--include <file>" (multiple provided).',
    };
  }

  // Force single worker and inspector for deterministic debugging
  normalized.push('--pool.maxWorkers=1');
  normalized.push('--pool.execArgv=--inspect-brk=0');

  return { args: normalized };
};

// ============================================================================
// Runner Process
// ============================================================================

export const spawnRunner = (runner: RunnerConfig): ChildProcess => {
  return spawn(runner.cmd, runner.args, {
    cwd: runner.cwd,
    env: { ...process.env, ...runner.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
};

export const waitForInspectorUrl = (child: ChildProcess): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    let output = '';
    const onData = (data: Buffer) => {
      output += data.toString();
      const match = output.match(/Debugger listening on (ws:\/\/[^\s]+)/);
      if (match?.[1]) {
        child.stderr?.off('data', onData);
        child.stdout?.off('data', onData);
        resolve(match[1]);
      }
    };
    child.stderr?.on('data', onData);
    child.stdout?.on('data', onData);
    child.on('exit', (code) => {
      reject(new Error(`Runner exited before inspector ready (code: ${code})`));
    });
  });
};

// ============================================================================
// Output Writer
// ============================================================================

export type OutputWriter = {
  write(output: DebugResult): void;
};

export const createOutputWriter = (outputPath?: string): OutputWriter => {
  const resolvedPath =
    typeof outputPath === 'string' && outputPath !== '-'
      ? path.resolve(outputPath)
      : null;

  return {
    write: (output) => {
      const payload = JSON.stringify(output, null, 2);
      if (resolvedPath) {
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        fs.writeFileSync(resolvedPath, payload, 'utf-8');
        return;
      }
      console.log(payload);
    },
  };
};
