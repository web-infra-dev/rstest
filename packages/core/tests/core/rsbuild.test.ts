import type { Rspack } from '@rsbuild/core';
import { join, normalize } from 'pathe';
import { prepareRsbuild } from '../../src/core/rsbuild';
import type { RstestContext } from '../../src/types';
import { TEMP_RSTEST_OUTPUT_DIR } from '../../src/utils';

process.env.DEBUG = 'false';

const rootPath = join(__dirname, '../..');

export function matchRules(
  config: Rspack.Configuration,
  testFile: string,
): Rspack.RuleSetRules {
  if (!config.module?.rules) {
    return [];
  }

  const isMatch = (test: Rspack.RuleSetCondition, testFile: string) => {
    if (test instanceof RegExp && test.test(testFile)) {
      return true;
    }
    return false;
  };

  return config.module.rules.filter((rule) => {
    if (rule && typeof rule === 'object' && rule.test) {
      if (isMatch(rule.test, testFile)) {
        return true;
      }

      if (
        Array.isArray(rule.test) &&
        rule.test.some((test) => isMatch(test, testFile))
      ) {
        return true;
      }
    }

    return false;
  });
}

describe('prepareRsbuild', () => {
  it('should generate rspack config correctly (jsdom)', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          tools: {},
          testEnvironment: {
            name: 'jsdom',
          },
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {},
              tools: {},
              testEnvironment: {
                name: 'jsdom',
              },
              browser: { enabled: false },
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generate rspack config correctly (node)', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          tools: {},
          testEnvironment: {
            name: 'node',
          },
          isolate: true,
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {},
              tools: {},
              testEnvironment: {
                name: 'node',
              },
              isolate: true,
              browser: { enabled: false },
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generate rspack config correctly with projects', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          pool: { type: 'forks' },
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {},
              tools: {},
              testEnvironment: {
                name: 'jsdom',
              },
              browser: { enabled: false },
            },
          },
          {
            name: 'test-node',
            rootPath,
            environmentName: 'test-node',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {},
              tools: {},
              testEnvironment: {
                name: 'node',
              },
              browser: { enabled: false },
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
    expect(bundlerConfigs[1]).toMatchSnapshot();
  });

  it('should respect output.distPath.root in rspack config', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {
            distPath: {
              root: 'custom/.rstest-temp',
            },
          },
          tools: {},
          testEnvironment: {
            name: 'node',
          },
          isolate: true,
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              tools: {},
              testEnvironment: {
                name: 'node',
              },
              isolate: true,
              browser: { enabled: false },
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );

    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(normalize(bundlerConfigs[0]!.output!.path!)).toBe(
      join(rootPath, 'custom/.rstest-temp'),
    );
  });

  it('should use global output.distPath.root for project rspack config', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {
            distPath: {
              root: 'global/.rstest-temp',
            },
          },
          tools: {},
          testEnvironment: {
            name: 'node',
          },
          isolate: true,
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {
                distPath: {
                  root: 'project/.rstest-temp',
                },
              },
              tools: {},
              testEnvironment: {
                name: 'node',
              },
              isolate: true,
              browser: { enabled: false },
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );

    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(normalize(bundlerConfigs[0]!.output!.path!)).toBe(
      join(rootPath, 'global/.rstest-temp'),
    );
  });

  it('should generate swc config correctly with user customize', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          testEnvironment: {
            name: 'node',
          },
          source: {
            decorators: {
              version: 'legacy',
            },
            include: [/node_modules[\\/]query-string[\\/]/],
          },
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          tools: {},
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {
                decorators: {
                  version: 'legacy',
                },
                include: [/node_modules[\\/]query-string[\\/]/],
              },
              output: {},
              tools: {},
              testEnvironment: {
                name: 'node',
              },
              browser: { enabled: false },
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(
      bundlerConfigs[0]?.module?.rules?.filter(
        (rule) =>
          rule &&
          typeof rule === 'object' &&
          rule.test &&
          rule.test instanceof RegExp &&
          rule.test.test('a.js'),
      ),
    ).toMatchSnapshot();
  });

  it('should respect user resolve.conditionNames and resolve.mainFields', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          tools: {},
          testEnvironment: {
            name: 'node',
          },
          isolate: true,
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {
                conditionNames: ['custom', 'node', 'import'],
                mainFields: ['source', 'main'],
              },
              source: {},
              output: {},
              tools: {},
              testEnvironment: {
                name: 'node',
              },
              isolate: true,
              browser: { enabled: false },
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );

    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]?.resolve?.conditionNames).toEqual([
      'custom',
      'node',
      'import',
    ]);
    expect(bundlerConfigs[0]?.resolve?.mainFields).toEqual(['source', 'main']);
  });

  it('should generate rspack config correctly in watch mode', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        command: 'watch',
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          tools: {},
          testEnvironment: {
            name: 'node',
          },
          isolate: true,
          coverage: {
            reportsDirectory: join(rootPath, './coverage'),
          },
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {},
              tools: {},
              testEnvironment: {
                name: 'node',
              },
              isolate: true,
              browser: { enabled: false },
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generate rspack config correctly (esm output)', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          tools: {},
          testEnvironment: {
            name: 'node',
          },
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            outputModule: true,
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {
                module: true,
              },
              tools: {},
              testEnvironment: {
                name: 'node',
              },
              browser: { enabled: false },
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generate rspack config correctly with less / sass plugin', async () => {
    const { pluginLess } = await import('@rsbuild/plugin-less');
    const { pluginSass } = await import('@rsbuild/plugin-sass');
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          tools: {},
          testEnvironment: {
            name: 'node',
          },
          isolate: true,
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [pluginLess(), pluginSass()],
              resolve: {},
              source: {},
              output: {},
              tools: {},
              testEnvironment: {
                name: 'node',
              },
              isolate: true,
              browser: { enabled: false },
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(matchRules(bundlerConfigs[0]!, 'a.less')).toMatchSnapshot(
      'less rules',
    );
    expect(matchRules(bundlerConfigs[0]!, 'a.sass')).toMatchSnapshot(
      'sass rules',
    );
  });
});
