import { projectRuntimeConfig } from '../../src/core/runtimeConfigProjection';
import type { ProjectContext } from '../../src/types';
import { serializableConfig } from '../../src/utils/helper';
import { unwrapRegex } from '../../src/utils/regexpWireFormat';

const baseNormalizedConfig = {
  testNamePattern: undefined as RegExp | string | undefined,
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
  coverage: { enabled: false, reporters: [] as unknown[] },
  snapshotFormat: {},
  env: {} as Record<string, string | undefined>,
  logHeapUsage: false,
  detectAsyncLeaks: false,
  bail: 0,
  chaiConfig: {},
  includeTaskLocation: false,
  silent: false,
};

const makeProject = (
  overrides: Partial<typeof baseNormalizedConfig> = {},
): ProjectContext =>
  ({
    normalizedConfig: { ...baseNormalizedConfig, ...overrides },
  }) as unknown as ProjectContext;

describe('projectRuntimeConfig', () => {
  it('static (browser) wire omits node-only fields', () => {
    const config = projectRuntimeConfig(makeProject(), { envMode: 'static' });
    expect('testEnvironment' in config).toBe(false);
    expect('coverage' in config).toBe(false);
    expect('logHeapUsage' in config).toBe(false);
    expect('detectAsyncLeaks' in config).toBe(false);
  });

  it('static env propagates only NODE_ENV + RSTEST plus config env', () => {
    const config = projectRuntimeConfig(makeProject({ env: { FOO: 'bar' } }), {
      envMode: 'static',
      env: { NODE_ENV: 'test', SECRET: 'hidden' },
    });
    expect(config.env).toEqual({
      NODE_ENV: 'test',
      RSTEST: 'true',
      FOO: 'bar',
    });
    // Arbitrary host env must NOT leak onto the browser wire.
    expect('SECRET' in (config.env ?? {})).toBe(false);
  });

  it('inherit (node) keeps node-only fields and strips coverage.reporters', () => {
    const config = projectRuntimeConfig(
      makeProject({
        coverage: { enabled: true, reporters: [() => {}] },
      }),
      { envMode: 'inherit' },
    );
    // reporters may be functions — stripped so the value stays serializable.
    expect(config.coverage.reporters).toEqual([]);
    expect('logHeapUsage' in config).toBe(true);
    expect('testEnvironment' in config).toBe(true);
  });

  it('inherit spreads the provided env base', () => {
    const config = projectRuntimeConfig(makeProject({ env: { FOO: 'bar' } }), {
      envMode: 'inherit',
      env: { HOST: 'yes' },
    });
    expect(config.env).toMatchObject({ HOST: 'yes', FOO: 'bar' });
  });

  it('testNamePattern round-trips through serializableConfig/unwrapRegex', () => {
    const config = projectRuntimeConfig(
      makeProject({ testNamePattern: /foo.*bar/i }),
      { envMode: 'static' },
    );
    const wired = serializableConfig(config);
    // Serialized form is a string on the wire.
    expect(typeof wired.testNamePattern).toBe('string');
    const restored = unwrapRegex(wired.testNamePattern as string);
    expect(restored).toBeInstanceOf(RegExp);
    expect((restored as RegExp).source).toBe('foo.*bar');
    expect((restored as RegExp).flags).toBe('i');
  });
});
