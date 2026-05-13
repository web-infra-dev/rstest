import { resolve } from 'pathe';
import { mergeRstestConfig, withDefaultConfig } from '../src/config';
import { Rstest } from '../src/core/rstest';
import type { RstestConfig } from '../src/types';
import { normalizeBuildCache, resolveProjectBuildCache } from '../src/utils';

// Mock std-env to ensure consistent snapshot across environments
rs.mock('std-env', () => ({
  isCI: false,
}));

describe('mergeRstestConfig', () => {
  it('should merge config correctly with default config', () => {
    const merged = withDefaultConfig({
      include: ['tests/**/*.test.ts'],
      root: __dirname,
      exclude: ['**/aa/**'],
      setupFiles: ['./setup.ts'],
      globalSetup: ['./global-setup.ts'],
      reporters: ['verbose'],
    });

    expect(merged).toMatchSnapshot();
  });

  it('should handle globalSetup array conversion', () => {
    const merged = withDefaultConfig({
      globalSetup: './single-global-setup.ts',
    });

    expect(merged.globalSetup).toEqual(['./single-global-setup.ts']);
  });

  it('should respect output.distPath.root when appending rstest temp exclude', () => {
    const merged = withDefaultConfig({
      root: __dirname,
      output: {
        distPath: {
          root: 'custom/.rstest-temp',
        },
      },
    });

    expect(merged.output?.distPath?.root).toBe('custom/.rstest-temp');
    expect(merged.exclude.patterns).toContain('**/custom/.rstest-temp');
  });

  it('should normalize string output.distPath to object in normalized config', () => {
    const merged = withDefaultConfig({
      root: __dirname,
      output: {
        distPath: 'custom/.rstest-temp',
      },
    });

    expect(merged.output?.distPath).toEqual({
      root: 'custom/.rstest-temp',
    });
  });

  it('should normalize performance.buildCache defaults for rstest', () => {
    const merged = withDefaultConfig({
      root: __dirname,
      source: {
        tsconfigPath: './tsconfig.custom.json',
      },
      performance: {
        buildCache: true,
      },
    });

    expect(merged.performance?.buildCache).toEqual({
      cacheDirectory: resolve(__dirname, 'node_modules/.cache/rstest'),
      cacheDigest: [
        'rstest',
        undefined,
        undefined,
        'node',
        'no-coverage',
        'dist/.rstest-temp',
      ],
      buildDependencies: [resolve(__dirname, 'tsconfig.custom.json')],
    });
  });

  it('should preserve custom buildCache fields while appending rstest defaults', () => {
    const merged = withDefaultConfig({
      root: __dirname,
      output: {
        distPath: 'custom/.rstest-temp',
      },
      performance: {
        buildCache: {
          cacheDirectory: './custom-cache',
          cacheDigest: ['user-digest'],
          buildDependencies: ['./a.config.ts'],
        },
      },
    });

    expect(merged.performance?.buildCache).toEqual({
      cacheDirectory: resolve(__dirname, 'custom-cache'),
      cacheDigest: [
        'rstest',
        undefined,
        undefined,
        'node',
        'no-coverage',
        'custom/.rstest-temp',
        'user-digest',
      ],
      buildDependencies: [resolve(__dirname, 'a.config.ts')],
    });
  });

  it('should include coverage state and provider in buildCache digest', () => {
    const withoutCoverage = withDefaultConfig({
      root: __dirname,
      performance: {
        buildCache: true,
      },
    });
    const withCoverage = withDefaultConfig({
      root: __dirname,
      coverage: {
        enabled: true,
      },
      performance: {
        buildCache: true,
      },
    });

    expect(withoutCoverage.performance?.buildCache).toMatchObject({
      cacheDigest: [
        'rstest',
        undefined,
        undefined,
        'node',
        'no-coverage',
        'dist/.rstest-temp',
      ],
    });
    expect(withCoverage.performance?.buildCache).toMatchObject({
      cacheDigest: [
        'rstest',
        undefined,
        undefined,
        'node',
        'coverage:istanbul',
        'dist/.rstest-temp',
      ],
    });

    const withCustomProvider = normalizeBuildCache({
      buildCache: true,
      root: __dirname,
      browserEnabled: false,
      coverageEnabled: true,
      coverageProvider: 'custom',
      outputDistPathRoot: 'dist/.rstest-temp',
    });

    expect(withCustomProvider).toMatchObject({
      cacheDigest: [
        'rstest',
        undefined,
        undefined,
        'node',
        'coverage:custom',
        'dist/.rstest-temp',
      ],
    });
  });

  it('should resolve buildCache buildDependencies relative to config file directory', () => {
    const rstest = new Rstest(
      {
        cwd: '/repo',
        command: 'run',
        configFilePath: '/repo/configs/rstest.config.mts',
        projects: [],
      },
      {
        performance: {
          buildCache: {
            buildDependencies: ['./cache-flags.ts'],
          },
        },
      },
    );

    expect(rstest.normalizedConfig.performance?.buildCache).toEqual({
      cacheDirectory: '/repo/node_modules/.cache/rstest',
      cacheDigest: [
        'rstest',
        undefined,
        undefined,
        'node',
        'no-coverage',
        'dist/.rstest-temp',
      ],
      buildDependencies: ['/repo/configs/cache-flags.ts'],
    });
  });

  it('should resolve inline project buildCache buildDependencies relative to root config file directory', () => {
    const rstest = new Rstest(
      {
        cwd: '/repo',
        command: 'run',
        configFilePath: '/repo/configs/rstest.config.mts',
        projects: [
          {
            config: {
              name: 'node',
              root: './projects/node',
              performance: {
                buildCache: {
                  buildDependencies: ['./cache-flags.ts'],
                },
              },
            },
          },
        ],
      },
      {},
    );

    expect(
      rstest.projects[0]?.normalizedConfig.performance?.buildCache
        ?.buildDependencies,
    ).toEqual(['/repo/configs/cache-flags.ts']);
  });

  it('should preserve explicit default buildCache directory for projects', () => {
    const rstest = new Rstest(
      {
        cwd: '/repo',
        command: 'run',
        configFilePath: '/repo/rstest.config.mts',
        projects: [
          {
            config: {
              name: 'node',
              root: './projects/node',
              performance: {
                buildCache: {
                  cacheDirectory: 'node_modules/.cache/rstest',
                },
              },
            },
          },
        ],
      },
      {},
    );

    expect(
      rstest.projects[0]?.normalizedConfig.performance?.buildCache
        ?.cacheDirectory,
    ).toBe('/repo/projects/node/node_modules/.cache/rstest');
    expect(
      resolveProjectBuildCache({
        context: rstest,
        project: rstest.projects[0]!,
      }),
    ).toMatchObject({
      cacheDirectory: '/repo/projects/node/node_modules/.cache/rstest',
    });
  });

  it('should append project name to default buildCache directory for per-project caches', () => {
    const rstest = new Rstest(
      {
        cwd: '/repo',
        command: 'run',
        configFilePath: '/repo/rstest.config.mts',
        projects: [
          {
            configFilePath: '/repo/projects/browser/rstest.config.mts',
            config: {
              name: 'browser',
              root: './projects/browser',
              performance: {
                buildCache: true,
              },
            },
          },
          {
            configFilePath: '/repo/projects/node/rstest.config.mts',
            config: {
              name: 'node',
              root: './projects/node',
              performance: {
                buildCache: true,
              },
            },
          },
        ],
      },
      {},
    );

    expect(
      rstest.projects[0]?.normalizedConfig.performance?.buildCache,
    ).toEqual({
      cacheDirectory:
        '/repo/projects/browser/node_modules/.cache/rstest-browser',
      cacheDigest: [
        'rstest',
        undefined,
        'browser',
        'node',
        'no-coverage',
        'dist/.rstest-temp',
      ],
      buildDependencies: [],
    });
    expect(
      rstest.projects[1]?.normalizedConfig.performance?.buildCache,
    ).toEqual({
      cacheDirectory: '/repo/projects/node/node_modules/.cache/rstest-node',
      cacheDigest: [
        'rstest',
        undefined,
        'node',
        'node',
        'no-coverage',
        'dist/.rstest-temp',
      ],
      buildDependencies: [],
    });
    expect(
      resolveProjectBuildCache({
        context: rstest,
        project: rstest.projects[1]!,
      }),
    ).toMatchObject({
      cacheDirectory: '/repo/projects/node/node_modules/.cache/rstest-node',
    });
  });

  it('should merge exclude correctly', () => {
    expect(
      mergeRstestConfig(
        {
          exclude: ['**/node_modules/**'],
        },
        {
          exclude: {
            patterns: ['**/dist/**'],
            override: true,
          },
        },
      ),
    ).toEqual({
      exclude: {
        patterns: ['**/dist/**'],
      },
    });

    expect(
      mergeRstestConfig(
        {
          exclude: ['**/node_modules/**'],
        },
        {
          exclude: {
            patterns: ['**/dist/**'],
            override: false,
          },
        },
      ),
    ).toEqual({
      exclude: {
        patterns: ['**/node_modules/**', '**/dist/**'],
        override: false,
      },
    });

    expect(
      mergeRstestConfig(
        {
          exclude: {
            patterns: ['**/dist/**'],
            override: false,
          },
        },
        {
          exclude: ['**/node_modules/**'],
        },
        {
          exclude: {
            patterns: ['**/aa/**'],
            override: true,
          },
        },
      ),
    ).toEqual({
      exclude: {
        patterns: ['**/aa/**'],
      },
    });
  });
});

describe('withDefaultConfig browser normalization', () => {
  it('should not throw when browser.enabled is true and provider is missing', () => {
    const config = {
      browser: { enabled: true },
    } as RstestConfig;

    expect(() => withDefaultConfig(config)).not.toThrow();
  });

  it('should preserve custom provider value for browser loader validation', () => {
    const config = {
      browser: { enabled: true, provider: 'invalid' },
    } as unknown as RstestConfig;

    const normalized = withDefaultConfig(config);
    expect(normalized.browser.provider).toBe('invalid');
  });

  it('should not throw when browser.enabled is true and provider is playwright', () => {
    const config: RstestConfig = {
      browser: { enabled: true, provider: 'playwright' },
    };

    expect(() => withDefaultConfig(config)).not.toThrow();
  });

  it('should preserve viewport value for browser loader validation', () => {
    const config = {
      browser: {
        enabled: true,
        provider: 'playwright',
        viewport: 'iPhone99',
      },
    } as unknown as RstestConfig;

    const normalized = withDefaultConfig(config);
    expect(normalized.browser.viewport).toBe('iPhone99');
  });

  it('should not throw when browser.viewport preset id is valid', () => {
    const config: RstestConfig = {
      browser: {
        enabled: true,
        provider: 'playwright',
        viewport: 'iPhone12Pro',
      },
    };

    expect(() => withDefaultConfig(config)).not.toThrow();
  });

  it('should not throw when browser.enabled is false without provider', () => {
    const config = {
      browser: { enabled: false },
    } as RstestConfig;

    expect(() => withDefaultConfig(config)).not.toThrow();
  });

  it('should not throw when browser is empty object', () => {
    const config = {
      browser: {},
    } as RstestConfig;

    expect(() => withDefaultConfig(config)).not.toThrow();
  });

  it('should not throw when browser is not specified', () => {
    const config: RstestConfig = {};

    expect(() => withDefaultConfig(config)).not.toThrow();
  });
});
