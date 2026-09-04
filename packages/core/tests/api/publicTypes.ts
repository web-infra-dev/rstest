import { loadConfig } from '@rstest/core';
import {
  createRstest,
  type CreateRstestOptions,
  type ListOptions,
  type LoadedRstestConfig,
  type RstestConfig,
  type RunOptions,
  type SerializedError,
  type TestCaseResult,
  type TestFileRunResult,
  type TestRunResult,
} from '@rstest/core/api';
export type {
  CoverageMapData,
  FileFilterMode,
  NormalizedConfig,
  ProjectContext,
  RstestContext,
  SnapshotSummary,
  TaskMeta,
  TestLocation,
} from '@rstest/core/api';
import type { CommonOptions } from '../../src/cli/init';
import type {
  FormattedError,
  TestFileResult as InternalTestFileResult,
  TestResult as InternalTestResult,
} from '../../src/types';

declare const config: RstestConfig;

type ProjectionDisposition = 'projected' | 'internal';
type ProjectedKeys<Disposition extends Record<PropertyKey, PropertyKey>> = {
  [Key in keyof Disposition]: Disposition[Key] extends 'internal'
    ? never
    : Disposition[Key] extends 'projected'
      ? Key
      : Disposition[Key];
}[keyof Disposition];
type SameKeys<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type Assert<Condition extends true> = Condition;

export type RunOptionsCommonFieldsAreForwarded = Assert<
  Exclude<
    keyof RunOptions,
    'filters' | 'filterMode'
  > extends keyof CommonOptions
    ? true
    : false
>;

// `projected` promises a same-named field; another public key records a rename.
export const testResultDisposition = {
  testId: 'internal',
  status: 'projected',
  name: 'projected',
  testPath: 'projected',
  parentNames: 'projected',
  duration: 'projected',
  errors: 'projected',
  retryErrors: 'projected',
  retryCount: 'projected',
  project: 'projected',
  meta: 'projected',
  heap: 'internal',
} satisfies Record<keyof InternalTestResult, ProjectionDisposition>;
export type TestResultProjectionMatchesPublic = Assert<
  SameKeys<ProjectedKeys<typeof testResultDisposition>, keyof TestCaseResult>
>;

export const testFileResultDisposition = {
  ...testResultDisposition,
  results: 'tests',
  snapshotResult: 'internal',
  coverage: 'internal',
  coverageRaw: 'internal',
  traceEvents: 'internal',
} satisfies Record<
  keyof InternalTestFileResult,
  ProjectionDisposition | keyof TestFileRunResult
>;
export type TestFileResultProjectionMatchesPublic = Assert<
  SameKeys<
    ProjectedKeys<typeof testFileResultDisposition>,
    keyof TestFileRunResult
  >
>;

export const formattedErrorDisposition = {
  fullStack: 'internal',
  message: 'projected',
  name: 'projected',
  stack: 'projected',
  diff: 'projected',
  expected: 'projected',
  actual: 'projected',
  retryCount: 'projected',
  cause: 'projected',
} satisfies Record<keyof FormattedError, ProjectionDisposition>;
export type FormattedErrorProjectionMatchesPublic = Assert<
  SameKeys<
    ProjectedKeys<typeof formattedErrorDisposition>,
    keyof SerializedError
  >
>;

export const testRunResultFields = {
  status: true,
  files: true,
  summary: true,
  unhandledErrors: true,
  duration: true,
  snapshot: true,
  coverage: true,
} satisfies Record<keyof TestRunResult, true>;

export const listOptionFields = {
  filesOnly: true,
  includeSuites: true,
  includeLocation: true,
} satisfies Record<keyof ListOptions, true>;

export const configOptions: CreateRstestOptions = { config };
export const createFromLoadedConfig = async (): Promise<void> => {
  const loaded = await loadConfig();
  const loadedConfig: LoadedRstestConfig = loaded;
  await createRstest({ config: loadedConfig });
};
