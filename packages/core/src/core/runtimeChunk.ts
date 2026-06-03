import type { Rspack } from '@rsbuild/core';

/** Base name for the Rstest runtime chunk shared by setup and test files. */
export const RUNTIME_CHUNK_BASE_NAME = 'runtime';

/**
 * Derive the per-environment runtime chunk name (e.g. `node-runtime`).
 *
 * Single source of truth for the producer (rspack `runtimeChunk.name` in
 * `core/plugins/basic.ts`) and the build/watch consumers that look the chunk
 * back up by name in `rsbuild.ts`.
 */
export const runtimeChunkNameForEnvironment = (
  environmentName: string,
): string => `${environmentName}-${RUNTIME_CHUNK_BASE_NAME}`;

/**
 * Identify the runtime chunk within a build's stats chunks. Matches on either
 * the chunk id or its names, mirroring how rspack reports the runtime chunk.
 */
export const isRuntimeChunk = (
  chunk: Pick<Rspack.StatsChunk, 'id' | 'names'>,
  runtimeChunkName: string,
): boolean =>
  chunk.id === runtimeChunkName ||
  (chunk.names?.includes(runtimeChunkName) ?? false);
