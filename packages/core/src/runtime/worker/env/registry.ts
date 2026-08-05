import type {
  EnvironmentName,
  TestEnvironment,
  TestEnvironmentContext,
  TestEnvironmentReturn,
} from '../../../types';
import type { LoadedTestEnvironmentModule } from './testEnvironmentModule';

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
  () => Promise<{
    environment: TestEnvironment<typeof globalThis>;
    setup: (
      global: typeof globalThis,
      options: Record<string, any>,
      context: TestEnvironmentContext,
      environmentModule?: LoadedTestEnvironmentModule,
    ) => Promise<TestEnvironmentReturn>;
  }>
> = {
  jsdom: async () => {
    const { environment, setupEnvironment } = await import('./jsdom');
    return {
      environment,
      setup: (global, options, context, environmentModule) =>
        setupEnvironment(
          global,
          options,
          context,
          environmentModule?.name === 'jsdom'
            ? environmentModule.module
            : undefined,
        ),
    };
  },
  'happy-dom': async () => {
    const { environment, setupEnvironment } = await import('./happyDom');
    return {
      environment,
      setup: (global, options, context, environmentModule) =>
        setupEnvironment(
          global,
          options,
          context,
          environmentModule?.name === 'happy-dom'
            ? environmentModule.module
            : undefined,
        ),
    };
  },
};
