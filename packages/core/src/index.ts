import type { RsbuildPlugin } from '@rsbuild/core';
import type {
  CoverageOptions,
  CoverageProvider,
  InlineProjectConfig,
  NormalizedCoverageOptions,
  RawCoverageResolveOptions,
  RstestExposeAPI,
  ProjectConfig,
  ResolvedRstestConfig,
  RstestConfig,
} from './types';

export { loadConfig, mergeProjectConfig, mergeRstestConfig } from './config';
export * from './runtime/api/public';

export type {
  CoverageOptions,
  CoverageProvider,
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
  Fixtures,
  Matchers,
  ProjectConfig,
  RealTimers,
  Reporter,
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
