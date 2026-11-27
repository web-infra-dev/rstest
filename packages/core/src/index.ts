import type { RsbuildPlugin } from '@rsbuild/core';
import type { RuntimeRstest } from './runtime/api';
import { getRuntimeAPI } from './runtime/api/global';
import type {
  BrowserInstanceConfig,
  BrowserExpectConfig,
  BrowserName,
  BrowserViewport,
  CoverageOptions,
  CoverageProvider,
  ExpectConfig,
  ExpectPollConfig,
  InlineProjectConfig,
  KnownCoverageStructure,
  NormalizedCoverageOptions,
  RawCoverageResolveOptions,
  RstestExposeAPI,
  ProjectConfig,
  ResolvedRstestConfig,
  RstestConfig,
} from './types';

export { loadConfig, mergeProjectConfig, mergeRstestConfig } from './config';
export * from './runtime/api/public';

// External packages may load this entry inside a VM. The worker owns the
// cleanup registries and publishes its registrars into each runtime realm.
export const registerWorkerCleanup: RuntimeRstest['registerWorkerCleanup'] = (
  cleanup,
) => getRuntimeAPI('registerWorkerCleanup')(cleanup);
export const registerFileCleanup: RuntimeRstest['registerFileCleanup'] = (
  cleanup,
) => getRuntimeAPI('registerFileCleanup')(cleanup);

export type {
  BrowserInstanceConfig,
  BrowserExpectConfig,
  BrowserName,
  BrowserViewport,
  CoverageOptions,
  CoverageProvider,
  ExpectConfig,
  ExpectPollConfig,
  KnownCoverageStructure,
  NormalizedCoverageOptions,
  RawCoverageResolveOptions,
  ResolvedRstestConfig,
  RsbuildPlugin,
  RstestConfig,
  RstestExposeAPI,
};

export type RstestConfigAsyncFn = () => Promise<RstestConfig>;

export type RstestConfigSyncFn = () => RstestConfig;

export type RstestConfigExport =
  RstestConfig | RstestConfigSyncFn | RstestConfigAsyncFn;

/**
 * This function helps you to autocomplete configuration types.
 * It accepts a Rstest config object, or a function that returns a config.
 */
export function defineConfig<
  const Config extends RstestConfig,
  const Definition extends Config | (() => Config) | (() => Promise<Config>),
>(
  config: Definition &
    (Definition extends (...args: never[]) => infer CallbackResult
      ? [Awaited<CallbackResult>] extends [RstestConfig]
        ? unknown
        : never
      : RstestConfig &
          Record<Exclude<keyof Definition, keyof RstestConfig>, never>),
): Definition extends (...args: never[]) => infer CallbackResult
  ? [CallbackResult] extends [RstestConfig]
    ? RstestConfigSyncFn
    : RstestConfigAsyncFn
  : RstestConfig;
export function defineConfig<const Config extends RstestConfig>(
  config: () => Config,
): RstestConfigSyncFn;
export function defineConfig<const Config extends RstestConfig>(
  config: () => Promise<Config>,
): RstestConfigAsyncFn;
export function defineConfig(config: RstestConfig): RstestConfig;
export function defineConfig(config: RstestConfigExport): RstestConfigExport;
export function defineConfig(config: RstestConfigExport) {
  return config;
}

type NestedProjectConfig = {
  projects: (InlineProjectConfig | string)[];
};

type ExportedProjectConfig = ProjectConfig;
type RstestProjectConfig = ExportedProjectConfig | NestedProjectConfig;

type ProjectConfigAsyncFn = () => Promise<ExportedProjectConfig>;
type NestedProjectConfigAsyncFn = () => Promise<NestedProjectConfig>;
type ProjectConfigSyncFn = () => ExportedProjectConfig;
type NestedProjectConfigSyncFn = () => NestedProjectConfig;

type RstestProjectConfigExport =
  | RstestProjectConfig
  | ProjectConfigSyncFn
  | NestedProjectConfigSyncFn
  | ProjectConfigAsyncFn
  | NestedProjectConfigAsyncFn;

/**
 * This function helps you to autocomplete inline project configuration types.
 */
export function defineInlineProject(
  config: InlineProjectConfig,
): InlineProjectConfig;
export function defineInlineProject(config: InlineProjectConfig) {
  return config;
}

/**
 * This function helps you to autocomplete project configuration types.
 * It accepts an inline or nested Rstest project config object, or a function that returns one.
 */
export function defineProject<const Config extends RstestProjectConfig>(
  config: () => Config,
): Config extends NestedProjectConfig
  ? NestedProjectConfigSyncFn
  : ProjectConfigSyncFn;
export function defineProject<const Config extends RstestProjectConfig>(
  config: () => Promise<Config>,
): Config extends NestedProjectConfig
  ? NestedProjectConfigAsyncFn
  : ProjectConfigAsyncFn;
export function defineProject(
  config: ExportedProjectConfig,
): ExportedProjectConfig;
export function defineProject(config: NestedProjectConfig): NestedProjectConfig;
export function defineProject(config: RstestProjectConfigExport) {
  return config;
}

export type { Rspack } from '@rsbuild/core';

export type {
  Assertion,
  DescribeAPI as Describe,
  AsymmetricMatchersContaining,
  ExpectStatic,
  ExtendConfig,
  ExtendConfigFn,
  FixtureCleanup,
  FixtureLifecycle,
  FileFixtureOptions,
  WorkerFixtureOptions,
  Fixtures,
  Matchers,
  ProjectConfig,
  RealTimers,
  Reporter,
  ReporterContext,
  NormalizedConfig,
  Duration,
  GetSourcemap,
  SourceMapInput,
  SnapshotSummary,
  CoverageMapData,
  SerializedError,
  TestResultStatus,
  TestRunStatus,
  TestRunStartPayload,
  TestRunEndPayload,
  TestRunSummary,
  UserConsoleLog,
  MaybePromise,
  Rstest,
  RstestCommand,
  RstestExpect as Expect,
  RstestUtilities,
  TaskMeta,
  TaskMetaValue,
  TestCaseInfo,
  TestContext,
  TestAPIs,
  TestForFn,
  TestFileInfo,
  TestFileResult,
  TestInfo,
  TestOptions,
  TestResult,
  TestSuiteInfo,
  Use,
} from './types';
