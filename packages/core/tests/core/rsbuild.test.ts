import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import { join, normalize } from 'pathe';
import { prepareRsbuild } from '../../src/core/rsbuild';
import type { RstestContext, RstestExposeAPI } from '../../src/types';
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
  it('should expose project-scoped rstest API to Rsbuild plugins', async () => {
    const createModifyRstestConfigPlugin = (
      include: string,
    ): RsbuildPlugin => ({
      name: `modify-rstest-config-${include}`,
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig((config) => {
          config.include = [include];
        });
      },
    });

    const projectA = {
      name: 'project-a',
      rootPath,
      environmentName: 'project-a',
      normalizedConfig: {
        include: ['original-a'],
        plugins: [createModifyRstestConfigPlugin('from-project-a')],
        resolve: {},
        source: {},
        output: {},
        tools: {},
        testEnvironment: {
          name: 'node',
        },
        browser: { enabled: false },
      },
    };
    const projectB = {
      name: 'project-b',
      rootPath,
      environmentName: 'project-b',
      normalizedConfig: {
        include: ['original-b'],
        plugins: [createModifyRstestConfigPlugin('from-project-b')],
        resolve: {},
        source: {},
        output: {},
        tools: {},
        testEnvironment: {
          name: 'node',
        },
        browser: { enabled: false },
      },
    };

    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        command: 'run',
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          pool: { type: 'forks' },
        },
        projects: [projectA, projectB],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );

    await rsbuildInstance.initConfigs();

    expect(projectA.normalizedConfig.include).toEqual(['from-project-a']);
    expect(projectB.normalizedConfig.include).toEqual(['from-project-b']);
  });

  it('should apply modified rstest config before generating rsbuild config', async () => {
    const modifyRstestConfigPlugin: RsbuildPlugin = {
      name: 'modify-rstest-config-before-rsbuild-config',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig((config) => {
          config.include = ['**/*.modified.test.ts'];
          config.testEnvironment = {
            name: 'jsdom',
          };
          config.resolve = {
            ...config.resolve,
            alias: {
              ...(config.resolve?.alias || {}),
              '@modified': '/virtual/modified',
            },
          };
          config.source = {
            ...config.source,
            define: {
              ...(config.source?.define || {}),
              __RSTEST_MODIFIED__: JSON.stringify('yes'),
            },
          };
        });
      },
    };

    const project = {
      name: 'test',
      rootPath,
      environmentName: 'test',
      normalizedConfig: {
        include: ['original.test.ts'],
        plugins: [modifyRstestConfigPlugin],
        resolve: {},
        source: {},
        output: {},
        tools: {},
        testEnvironment: {
          name: 'node',
        },
        browser: { enabled: false },
      },
    };

    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        command: 'run',
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          pool: { type: 'forks' },
        },
        projects: [project],
      } as unknown as RstestContext,
      async () => ({}),
      {},
      {},
    );

    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(project.normalizedConfig.include).toEqual(['**/*.modified.test.ts']);
    expect(project.normalizedConfig.testEnvironment.name).toBe('jsdom');
    expect(bundlerConfigs[0]?.resolve?.alias).toMatchObject({
      '@modified': '/virtual/modified',
    });
    expect(bundlerConfigs[0]?.resolve?.conditionNames).toContain('browser');
    expect(JSON.stringify(bundlerConfigs[0]?.plugins)).toContain(
      '__RSTEST_MODIFIED__',
    );
  });

  it('should not allow modifyRstestConfig to switch browser mode', async () => {
    const modifyBrowserModePlugin: RsbuildPlugin = {
      name: 'modify-rstest-browser-mode',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig((config) => {
          config.browser = {
            ...config.browser,
            enabled: true,
          };
        });
      },
    };

    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        command: 'run',
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              include: ['original.test.ts'],
              plugins: [modifyBrowserModePlugin],
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

    await expect(rsbuildInstance.initConfigs()).rejects.toThrow(
      'Cannot modify `browser.enabled` in `modifyRstestConfig`',
    );
  });

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

  it('should use web conditionNames by default for jsdom environment', async () => {
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
                name: 'jsdom',
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
      'browser',
      '...',
    ]);
  });

  it('should append user resolve.conditionNames in jsdom environment', async () => {
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
                conditionNames: ['modern:source', 'require', 'node', 'default'],
              },
              source: {},
              output: {},
              tools: {},
              testEnvironment: {
                name: 'jsdom',
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
      'modern:source',
      'require',
      'node',
      'default',
    ]);
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

  it('should pass normalized performance.buildCache to rsbuild config', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        command: 'run',
        configFilePath: join(rootPath, 'rstest.config.ts'),
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          performance: {
            buildCache: {
              cacheDirectory: join(rootPath, 'node_modules/.cache/rstest-test'),
              cacheDigest: ['root-digest'],
              buildDependencies: [join(rootPath, 'rstest.config.ts')],
            },
          },
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
            configFilePath: join(rootPath, 'projects/test/rstest.config.ts'),
            normalizedConfig: {
              plugins: [],
              performance: {
                buildCache: {
                  cacheDirectory: join(
                    rootPath,
                    'node_modules/.cache/rstest-test',
                  ),
                  cacheDigest: ['root-digest'],
                  buildDependencies: [join(rootPath, 'rstest.config.ts')],
                },
              },
              resolve: {},
              source: {
                tsconfigPath: join(rootPath, 'tsconfig.json'),
              },
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

    const { origin } = await rsbuildInstance.inspectConfig();

    expect(origin).toBeDefined();
    expect(
      (origin as any).environmentConfigs?.test?.performance?.buildCache,
    ).toEqual({
      cacheDirectory: join(rootPath, 'node_modules/.cache/rstest-test'),
      cacheDigest: [
        'rstest',
        'run',
        'test',
        'node',
        'no-coverage',
        TEMP_RSTEST_OUTPUT_DIR,
        'root-digest',
      ],
      buildDependencies: [
        join(rootPath, 'projects/test/rstest.config.ts'),
        join(rootPath, 'tsconfig.json'),
        join(rootPath, 'rstest.config.ts'),
      ],
    });
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
