import type { CoverageOptions, CoverageProvider, RstestConfig } from './types';

export type { RsbuildPlugin } from '@rsbuild/core';

export * from './runtime/api/public';

export type { CoverageOptions, CoverageProvider, RstestConfig };

export type RstestConfigAsyncFn = () => Promise<RstestConfig>;

export type RstestConfigSyncFn = () => RstestConfig;

export type RstestConfigExport =
  | RstestConfig
  | RstestConfigSyncFn
  | RstestConfigAsyncFn;

/**
 * This function helps you to autocomplete configuration types.
 * It accepts a Rsbuild config object, or a function that returns a config.
 */
export function defineConfig(config: RstestConfig): RstestConfig;
export function defineConfig(config: RstestConfigSyncFn): RstestConfigSyncFn;
export function defineConfig(config: RstestConfigAsyncFn): RstestConfigAsyncFn;
export function defineConfig(config: RstestConfigExport): RstestConfigExport;
export function defineConfig(config: RstestConfigExport) {
  return config;
}
