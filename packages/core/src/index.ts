import type { RsbuildPlugin } from '@rsbuild/core';
import type {
  CoverageOptions,
  CoverageProvider,
  NormalizedCoverageOptions,
  ProjectConfig,
  RstestConfig,
} from './types';

export { initCli, runCLI } from './cli';
export { loadConfig, mergeRstestConfig } from './config';
export { createRstest } from './core';

export * from './runtime/api/public';

export type {
  NormalizedCoverageOptions,
  CoverageOptions,
  CoverageProvider,
  RstestConfig,
  RsbuildPlugin,
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

type ProjectConfigAsyncFn = () => Promise<ProjectConfig>;

type ProjectConfigSyncFn = () => ProjectConfig;

type RstestProjectConfigExport =
  | ProjectConfig
  | ProjectConfigSyncFn
  | ProjectConfigAsyncFn;

/**
 * This function helps you to autocomplete configuration types.
 * It accepts a Rstest project config object, or a function that returns a config.
 */
export function defineProject(config: ProjectConfig): ProjectConfig;
export function defineProject(config: ProjectConfigSyncFn): ProjectConfigSyncFn;
export function defineProject(
  config: ProjectConfigAsyncFn,
): ProjectConfigAsyncFn;
export function defineProject(config: RstestProjectConfigExport) {
  return config;
}

export type {
  ProjectConfig,
  Reporter,
  RstestCommand,
  TestFileInfo,
  TestFileResult,
  TestResult,
} from './types';
