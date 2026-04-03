import type { RsbuildPlugin } from '@rsbuild/core';
import type {
  CoverageOptions,
  CoverageProvider,
  InlineProjectConfig,
  NormalizedCoverageOptions,
  ProjectConfig,
  RstestConfig,
} from './types';

export { initCli, runCLI } from './cli';
export { loadConfig, mergeProjectConfig, mergeRstestConfig } from './config';
export { createRstest } from './core';
export * from './runtime/api/public';

export type {
  CoverageOptions,
  CoverageProvider,
  NormalizedCoverageOptions,
  RsbuildPlugin,
  RstestConfig,
};

export type RstestConfigAsyncFn = () => Promise<RstestConfig>;

export type RstestConfigSyncFn = () => RstestConfig;

export type RstestConfigExport =
  | RstestConfig
  | RstestConfigSyncFn
  | RstestConfigAsyncFn;

/**
 * This function helps you to autocomplete configuration types.
 * It accepts a Rstest config object, or a function that returns a config.
 */
export function defineConfig(config: RstestConfig): RstestConfig;
export function defineConfig(config: RstestConfigSyncFn): RstestConfigSyncFn;
export function defineConfig(config: RstestConfigAsyncFn): RstestConfigAsyncFn;
export function defineConfig(config: RstestConfigExport): RstestConfigExport;
export function defineConfig(config: RstestConfigExport) {
  return config;
}

type NestedProjectConfig = {
  projects: (InlineProjectConfig | string)[];
};

type ExportedProjectConfig = ProjectConfig;

type ProjectConfigAsyncFn = () => Promise<ExportedProjectConfig>;
type NestedProjectConfigAsyncFn = () => Promise<NestedProjectConfig>;
type ProjectConfigSyncFn = () => ExportedProjectConfig;
type NestedProjectConfigSyncFn = () => NestedProjectConfig;

type RstestProjectConfigExport =
  | ExportedProjectConfig
  | NestedProjectConfig
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
export function defineProject(
  config: ExportedProjectConfig,
): ExportedProjectConfig;
export function defineProject(config: NestedProjectConfig): NestedProjectConfig;
export function defineProject(config: ProjectConfigSyncFn): ProjectConfigSyncFn;
export function defineProject(
  config: NestedProjectConfigSyncFn,
): NestedProjectConfigSyncFn;
export function defineProject(
  config: ProjectConfigAsyncFn,
): ProjectConfigAsyncFn;
export function defineProject(
  config: NestedProjectConfigAsyncFn,
): NestedProjectConfigAsyncFn;
export function defineProject(config: RstestProjectConfigExport) {
  return config;
}

export type { Rspack } from '@rsbuild/core';

export type {
  Assertion,
  DescribeAPI as Describe,
  ExpectStatic,
  ExtendConfig,
  ExtendConfigFn,
  ProjectConfig,
  Reporter,
  Rstest,
  RstestCommand,
  RstestExpect as Expect,
  RstestUtilities,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestInfo,
  TestResult,
  TestSuiteInfo,
} from './types';
