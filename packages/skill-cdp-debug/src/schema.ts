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
  cmd: v.string(),
  args: v.array(v.string()),
  cwd: v.string(),
  env: v.fallback(v.optional(v.record(v.string(), v.string())), {}),
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
  id: v.optional(v.string()),
  description: v.optional(v.string()),
  sourcePath: v.string(),
  // 1-based
  line: v.pipe(v.number(), v.integer(), v.minValue(1)),
  // 0-based
  column: v.fallback(
    v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    0,
  ),
  expressions: v.optional(v.array(v.string())),
  hitLimit: v.fallback(
    v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    1,
  ),
  condition: v.optional(v.string()),
  order: v.optional(v.pipe(v.number(), v.integer())),
  hits: v.fallback(
    v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    0,
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

export const PlanInputSchema: v.GenericSchema<PlanInput, PlanOutput> = v.object(
  {
    runner: RunnerConfigSchema,
    tasks: v.pipe(v.array(TaskDefinitionInputSchema), v.nonEmpty()),
  },
);
