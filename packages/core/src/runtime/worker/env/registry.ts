import type { EnvironmentName, TestEnvironment } from '../../../types';

/**
 * Lazy loaders for the non-`node` test environments, keyed by environment name.
 *
 * `node` is the no-op fast path handled directly by the dispatcher in
 * `runInPool.ts`, so it is intentionally absent here. The exhaustive `Record`
 * keeps the dispatcher closed: adding a name to {@link EnvironmentName} forces a
 * matching loader entry. Dynamic `import()` preserves the lazy-load behavior of
 * the previous hand-written switch.
 */
export const environmentLoaders: Record<
  Exclude<EnvironmentName, 'node'>,
  () => Promise<{ environment: TestEnvironment<typeof globalThis> }>
> = {
  jsdom: () => import('./jsdom'),
  'happy-dom': () => import('./happyDom'),
};
