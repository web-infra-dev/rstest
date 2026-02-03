import * as v from 'valibot';

/**
 * Plan schema (SSoT) for `--plan` input.
 *
 * Notes:
 * - `tasks[].id` is optional on input; the CLI will assign `task-<n>`.
 * - Some fields are derived at runtime (e.g. `order` defaults to task index).
 */

export type RunnerConfigInput = {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
};

export type RunnerConfigOutput = {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
};

export const RunnerConfigSchema: v.GenericSchema<
  RunnerConfigInput,
  RunnerConfigOutput
> = v.object({
  cmd: v.pipe(v.string(), v.description('Runner command. Example: "pnpm".')),
  args: v.pipe(
    v.array(v.string()),
    v.description('Runner arguments. Example: ["rstest", "run", ...].'),
  ),
  cwd: v.pipe(
    v.string(),
    v.description('Working directory for the runner process.'),
  ),
  env: v.pipe(
    v.fallback(v.optional(v.record(v.string(), v.string())), {}),
    v.description('Environment variables passed to the runner. Default: {}.'),
  ),
});

export type TaskDefinitionInput = {
  id?: string;
  description?: string;
  sourcePath: string;
  line: number;
  column?: number;
  expressions?: string[];
  hitLimit?: number;
  condition?: string;
  order?: number;
  hits?: number;
};

export type TaskDefinitionOutput = {
  id?: string;
  description?: string;
  sourcePath: string;
  line: number;
  column?: number;
  expressions?: string[];
  hitLimit?: number;
  condition?: string;
  order?: number;
  hits?: number;
};

export const TaskDefinitionInputSchema: v.GenericSchema<
  TaskDefinitionInput,
  TaskDefinitionOutput
> = v.object({
  id: v.pipe(
    v.optional(v.string()),
    v.description('Task id. If omitted, the CLI assigns "task-<n>".'),
  ),
  description: v.pipe(
    v.optional(v.string()),
    v.description('Human-readable task description.'),
  ),
  sourcePath: v.pipe(
    v.string(),
    v.description(
      'Absolute source file path in the runner workspace. Used for sourcemap mapping.',
    ),
  ),
  // 1-based
  line: v.pipe(
    v.pipe(v.number(), v.integer(), v.minValue(1)),
    v.description('1-based line number in the source file.'),
  ),
  // 0-based
  column: v.pipe(
    v.fallback(v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))), 0),
    v.description('0-based column number in the source file. Default: 0.'),
  ),
  expressions: v.pipe(
    v.optional(v.array(v.string())),
    v.description(
      'Expressions to evaluate on the paused call frame when this breakpoint is hit.',
    ),
  ),
  hitLimit: v.pipe(
    v.fallback(v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))), 1),
    v.description('Stop after this many hits. Default: 1.'),
  ),
  condition: v.pipe(
    v.optional(v.string()),
    v.description(
      'Conditional breakpoint expression (evaluated by the debugger). The breakpoint pauses only when this evaluates to a truthy value.',
    ),
  ),
  order: v.pipe(
    v.optional(v.pipe(v.number(), v.integer())),
    v.description('Optional ordering hint (lower values run first).'),
  ),
  hits: v.pipe(
    v.fallback(v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))), 0),
    v.description('Internal hit counter. Default: 0.'),
  ),
});

export type PlanInput = {
  runner: RunnerConfigInput;
  tasks: TaskDefinitionInput[];
};

export type PlanOutput = {
  runner: RunnerConfigOutput;
  tasks: TaskDefinitionOutput[];
};

export const PlanInputSchema: v.GenericSchema<PlanInput, PlanOutput> = v.pipe(
  v.object({
    runner: v.pipe(
      RunnerConfigSchema,
      v.description('Runner configuration used to execute the test command.'),
    ),
    tasks: v.pipe(
      v.pipe(v.array(TaskDefinitionInputSchema), v.nonEmpty()),
      v.description('List of breakpoint tasks. Must be non-empty.'),
    ),
  }),
  v.description('Plan JSON passed to the CLI via --plan <path|->.'),
);
