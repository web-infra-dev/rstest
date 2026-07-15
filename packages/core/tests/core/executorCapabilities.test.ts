import {
  browserIgnoredRuntimeConfigKeys,
  browserStrippedRuntimeConfigKeys,
  type CapabilityStatus,
  executorCapabilities,
} from '../../src/core/executorCapabilities';
import { projectRuntimeConfig } from '../../src/core/runtimeConfigProjection';
import type { ProjectContext, RuntimeConfig } from '../../src/types';

const makeProject = (): ProjectContext =>
  ({
    normalizedConfig: {
      testNamePattern: undefined,
      testTimeout: 5000,
      passWithNoTests: false,
      retry: 0,
      globals: false,
      clearMocks: false,
      resetMocks: false,
      restoreMocks: false,
      unstubEnvs: false,
      unstubGlobals: false,
      maxConcurrency: 5,
      printConsoleTrace: false,
      disableConsoleIntercept: false,
      testEnvironment: { name: 'node' },
      hookTimeout: 10000,
      isolate: true,
      coverage: { enabled: false, reporters: [] },
      snapshotFormat: {},
      env: {},
      logHeapUsage: false,
      detectAsyncLeaks: false,
      bail: 0,
      chaiConfig: {},
      includeTaskLocation: false,
      silent: false,
      runtimeTsTransform: true,
    },
  }) as unknown as ProjectContext;

describe('executorCapabilities', () => {
  it('assigns a valid status to every RuntimeConfig field for both executors', () => {
    const valid: CapabilityStatus[] = [
      'supported',
      'ignored-warn',
      'error',
      'stripped',
    ];
    for (const { node, browser } of Object.values(executorCapabilities)) {
      expect(valid).toContain(node);
      expect(valid).toContain(browser);
    }
  });

  it('the browser static projection omits EXACTLY the stripped fields', () => {
    const wire = projectRuntimeConfig(makeProject(), { envMode: 'static' });
    const wireKeys = new Set(Object.keys(wire));
    for (const key of Object.keys(
      executorCapabilities,
    ) as (keyof RuntimeConfig)[]) {
      const stripped = browserStrippedRuntimeConfigKeys.includes(key);
      // Stripped fields must be absent; every other field must be present.
      expect(wireKeys.has(key)).toBe(!stripped);
    }
  });

  it('stripped fields are a subset of the warn-worthy (ignored) fields', () => {
    for (const key of browserStrippedRuntimeConfigKeys) {
      expect(browserIgnoredRuntimeConfigKeys).toContain(key);
    }
  });
});
