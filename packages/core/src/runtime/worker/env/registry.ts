import type vm from 'node:vm';
import type {
  EnvironmentName,
  TestEnvironment,
  TestEnvironmentContext,
  TestEnvironmentReturn,
} from '../../../types';
import type { LoadedTestEnvironmentModule } from './testEnvironmentModule';

type VmEnvironmentReturn = {
  context: vm.Context;
  teardown: () => void | Promise<void>;
};

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
    setupVM: (
      options: Record<string, any>,
      context: TestEnvironmentContext,
      environmentModule?: LoadedTestEnvironmentModule,
    ) => Promise<VmEnvironmentReturn>;
  }>
> = {
  jsdom: async () => {
    const { environment, setupEnvironment, setupVM } = await import('./jsdom');
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
      setupVM: (options, context, environmentModule) =>
        setupVM(
          options,
          context,
          environmentModule?.name === 'jsdom'
            ? environmentModule.module
            : undefined,
        ),
    };
  },
  'happy-dom': async () => {
    const { environment, setupEnvironment, setupVM } =
      await import('./happyDom');
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
      setupVM: (options, context, environmentModule) =>
        setupVM(
          options,
          context,
          environmentModule?.name === 'happy-dom'
            ? environmentModule.module
            : undefined,
        ),
    };
  },
};
