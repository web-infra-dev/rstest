import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import { join, normalize } from 'pathe';
import {
  prepareRsbuild,
  syncCoverageSetupExcludes,
} from '../../src/core/rsbuild';
import { createSetupFileState } from '../../src/core/setupFileState';
import type { RstestContext, RstestExposeAPI } from '../../src/types';
import { listTests } from '../../src/core/listTests';
import { Rstest } from '../../src/core/rstest';
import { TEMP_RSTEST_OUTPUT_DIR } from '../../src/utils';

process.env.DEBUG = 'false';

const rootPath = join(__dirname, '../..');

rs.mock('../../src/core/browserLoader', () => ({
  loadBrowserModule: async () => ({
    validateBrowserConfig: () => undefined,
    listBrowserTests: async (
      context: RstestContext,
      options?: {
        shardedEntries?: Map<string, { entries: Record<string, string> }>;
      },
    ) => ({
      close: async () => undefined,
      list: context.projects
        .filter((project) => project.normalizedConfig.browser.enabled)
        .flatMap((project) =>
          Object.values(
            options?.shardedEntries?.get(project.environmentName)?.entries ||
              {},
          ).map((testPath) => ({
            project: project.name,
            testPath,
            tests: [],
          })),
        ),
    }),
    runBrowserTests: async () => undefined,
  }),
}));

rs.mock('../../src/pool', () => ({
  createPool: async () => ({
    close: async () => undefined,
    collectTests: async ({
      entries,
      project,
    }: Parameters<
      Awaited<
        ReturnType<typeof import('../../src/pool').createPool>
      >['collectTests']
    >[0]) =>
      entries.map((entry) => ({
        project: project.name,
        testPath: entry.testPath,
        tests: [],
      })),
  }),
}));

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
  it('should add setup files to coverage excludes without duplicates', () => {
    const coverage = {
      enabled: true,
      exclude: ['**/node_modules/**', '/project/setup.ts'],
      provider: 'istanbul',
      reporters: [],
      reportsDirectory: 'coverage',
      clean: true,
      reportOnFailure: false,
      allowExternal: false,
    } satisfies RstestContext['normalizedConfig']['coverage'];

    syncCoverageSetupExcludes(coverage, [
      '/project/setup.ts',
      '/project/globalSetup.ts',
    ]);

    expect(coverage.exclude).toEqual([
      '**/node_modules/**',
      '/project/setup.ts',
      '/project/globalSetup.ts',
    ]);
  });

  it('should list browser shard entries after node modifyRstestConfig hooks', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'rstest-list-shard-'));

    try {
      for (const file of [
        'aa-node.test.ts',
        'ab-node.test.ts',
        'b-browser.test.ts',
        'c-node.test.ts',
      ]) {
        writeFileSync(join(tempRoot, file), 'export {};\n');
      }

      const modifyIncludePlugin: RsbuildPlugin = {
        name: 'modify-rstest-list-shard-include',
        setup(api) {
          const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

          rstestApi?.modifyRstestConfig((config) => {
            config.include = [
              'aa-node.test.ts',
              'ab-node.test.ts',
              'c-node.test.ts',
            ];
          });
        },
      };

      const context = new Rstest(
        {
          cwd: tempRoot,
          command: 'list',
          embedded: true,
          projects: [
            {
              config: {
                name: 'node',
                root: tempRoot,
                include: ['c-node.test.ts'],
                plugins: [modifyIncludePlugin],
              },
            },
            {
              config: {
                name: 'browser',
                root: tempRoot,
                include: ['b-browser.test.ts'],
                browser: { enabled: true, provider: 'playwright' },
              },
            },
          ],
        },
        {
          root: tempRoot,
          shard: { index: 1, count: 2 },
        },
      );

      const list = await listTests(context, { json: false });

      expect(list.map((item) => item.testPath)).not.toContain(
        join(tempRoot, 'b-browser.test.ts'),
      );
      expect(context.projects[0]!.normalizedConfig.include).toEqual([
        'aa-node.test.ts',
        'ab-node.test.ts',
        'c-node.test.ts',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

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

    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

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

    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

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

    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

    await expect(rsbuildInstance.initConfigs()).rejects.toThrow(
      'Cannot modify `browser.enabled` in `modifyRstestConfig`',
    );
  });

  it('should keep normalized rstest config after modifyRstestConfig returns partial config', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'rstest-partial-config-'));
    writeFileSync(join(tempRoot, 'setup.ts'), 'export {};\n');
    writeFileSync(join(tempRoot, 'globalSetup.ts'), 'export {};\n');

    const modifyRstestConfigPlugin: RsbuildPlugin = {
      name: 'modify-rstest-config-partial-return',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig(() => ({
          include: ['**/*.partial.test.ts'],
          exclude: ['**/ignored.test.ts'],
          setupFiles: './setup.ts',
          globalSetup: './globalSetup.ts',
          testEnvironment: 'jsdom',
          root: tempRoot,
          output: {
            module: false,
          },
        }));
      },
    };

    const project = {
      name: 'test',
      rootPath,
      environmentName: 'test',
      normalizedConfig: {
        include: ['original.test.ts'],
        exclude: {
          patterns: ['**/original-ignored.test.ts'],
          override: false,
        },
        setupFiles: [],
        globalSetup: [],
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

    try {
      const rsbuildInstance = await prepareRsbuild({
        context: {
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
        globTestSourceEntries: async () => ({}),
        setupFileState: createSetupFileState(),
      });

      await rsbuildInstance.initConfigs();

      expect(project.normalizedConfig.include).toEqual([
        '**/*.partial.test.ts',
      ]);
      expect(project.rootPath).toBe(tempRoot);
      expect(project.outputModule).toBe(false);
      expect(project.normalizedConfig.browser.enabled).toBe(false);
      expect(project.normalizedConfig.exclude).toEqual({
        patterns: [
          '**/original-ignored.test.ts',
          '**/ignored.test.ts',
          expect.stringContaining(TEMP_RSTEST_OUTPUT_DIR),
        ],
        override: false,
      });
      expect(project.normalizedConfig.setupFiles).toEqual(['./setup.ts']);
      expect(project.normalizedConfig.globalSetup).toEqual([
        './globalSetup.ts',
      ]);
      expect(project.normalizedConfig.testEnvironment).toEqual({
        name: 'jsdom',
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('should derive setup file maps after modifyRstestConfig is applied', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'rstest-setup-maps-'));
    writeFileSync(join(tempRoot, 'setup.ts'), 'export {};\n');
    writeFileSync(join(tempRoot, 'globalSetup.ts'), 'export {};\n');

    const modifySetupPlugin: RsbuildPlugin = {
      name: 'modify-rstest-setup-files',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig((config) => {
          config.root = tempRoot;
          config.setupFiles = ['./setup.ts'];
          config.globalSetup = ['./globalSetup.ts'];
        });
      },
    };

    const setupFileState = createSetupFileState();

    try {
      const rsbuildInstance = await prepareRsbuild({
        context: {
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
                root: rootPath,
                setupFiles: [],
                globalSetup: [],
                plugins: [modifySetupPlugin],
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
        globTestSourceEntries: async () => ({}),
        setupFileState,
      });

      expect(setupFileState.setupFiles).toEqual({});
      expect(setupFileState.globalSetupFiles).toEqual({});

      await rsbuildInstance.initConfigs();

      expect(setupFileState.setupFiles.test).toEqual({
        'setup~ts': join(tempRoot, 'setup.ts'),
      });
      expect(setupFileState.globalSetupFiles.test).toEqual({
        'globalSetup~ts': join(tempRoot, 'globalSetup.ts'),
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('should preserve normalized defaults after modifyRstestConfig mutates public config shape', async () => {
    const modifyRstestConfigPlugin: RsbuildPlugin = {
      name: 'modify-rstest-config-public-mutation',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig((config) => {
          config.exclude = ['**/ignored.test.ts'];
          config.output = { module: false };
          config.root = './fixtures';
        });
      },
    };

    const project = {
      name: 'test',
      rootPath,
      environmentName: 'test',
      normalizedConfig: {
        root: rootPath,
        include: ['original.test.ts'],
        exclude: {
          patterns: ['**/node_modules/**', '**/dist/**'],
          override: false,
        },
        setupFiles: [],
        globalSetup: [],
        plugins: [modifyRstestConfigPlugin],
        resolve: {},
        source: {},
        output: {
          distPath: {
            root: TEMP_RSTEST_OUTPUT_DIR,
          },
        },
        tools: {},
        coverage: {
          enabled: false,
          exclude: ['**/node_modules/**'],
          provider: 'istanbul',
          reporters: ['text'],
          reportsDirectory: join(rootPath, 'coverage'),
          clean: true,
          reportOnFailure: false,
          allowExternal: false,
        },
        pool: { type: 'forks' },
        testEnvironment: {
          name: 'node',
        },
        browser: { enabled: false },
      },
    };

    const rsbuildInstance = await prepareRsbuild({
      context: {
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
          coverage: project.normalizedConfig.coverage,
          isolate: true,
          pool: { type: 'forks' },
        },
        projects: [project],
      } as unknown as RstestContext,
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

    await rsbuildInstance.initConfigs();

    expect(project.normalizedConfig.exclude).toEqual({
      patterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/ignored.test.ts',
        expect.stringContaining(TEMP_RSTEST_OUTPUT_DIR),
      ],
      override: false,
    });
    expect(project.rootPath).toBe(join(rootPath, 'fixtures'));
    expect(project.outputModule).toBe(false);
    expect(project.normalizedConfig.output?.distPath).toEqual({
      root: TEMP_RSTEST_OUTPUT_DIR,
    });
  });

  it('should replace arrays when modifyRstestConfig mutates public config arrays', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'rstest-array-mutation-'));
    for (const file of [
      'base-setup.ts',
      'extra-setup.ts',
      'base-global.ts',
      'extra-global.ts',
    ]) {
      writeFileSync(join(tempRoot, file), 'export {};\n');
    }

    const modifyRstestConfigPlugin: RsbuildPlugin = {
      name: 'modify-rstest-config-array-mutation',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig((config) => {
          config.setupFiles = [...config.setupFiles, 'extra-setup.ts'];
          config.globalSetup = [...config.globalSetup, 'extra-global.ts'];
          config.include = [...config.include, 'extra.test.ts'];
        });
      },
    };

    const project = {
      name: 'test',
      rootPath: tempRoot,
      environmentName: 'test',
      normalizedConfig: {
        root: tempRoot,
        include: ['base.test.ts'],
        exclude: {
          patterns: ['**/node_modules/**'],
          override: false,
        },
        setupFiles: ['base-setup.ts'],
        globalSetup: ['base-global.ts'],
        plugins: [modifyRstestConfigPlugin],
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
        browser: { enabled: false },
      },
    };

    try {
      const rsbuildInstance = await prepareRsbuild({
        context: {
          rootPath: tempRoot,
          command: 'run',
          normalizedConfig: {
            root: tempRoot,
            name: 'test',
            output: {
              distPath: {
                root: TEMP_RSTEST_OUTPUT_DIR,
              },
            },
            pool: { type: 'forks' },
          },
          projects: [project],
        },
        globTestSourceEntries: async () => ({}),
        setupFileState: createSetupFileState(),
      });

      await rsbuildInstance.initConfigs();

      expect(project.normalizedConfig.setupFiles).toEqual([
        'base-setup.ts',
        'extra-setup.ts',
      ]);
      expect(project.normalizedConfig.globalSetup).toEqual([
        'base-global.ts',
        'extra-global.ts',
      ]);
      expect(project.normalizedConfig.include).toEqual([
        'base.test.ts',
        'extra.test.ts',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('should refresh root-derived fields after modifyRstestConfig changes root', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'rstest-root-derived-'));
    const newRoot = join(tempRoot, 'fixture');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(join(tempRoot, 'tsconfig.json'), '{}\n');
    writeFileSync(join(newRoot, 'tsconfig.json'), '{}\n');

    const modifyRstestConfigPlugin: RsbuildPlugin = {
      name: 'modify-rstest-config-root-derived',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig((config) => {
          config.root = './fixture';
        });
      },
    };

    const project = {
      name: 'test',
      rootPath: tempRoot,
      environmentName: 'test',
      normalizedConfig: {
        root: tempRoot,
        include: ['base.test.ts'],
        exclude: {
          patterns: ['**/node_modules/**', '**/dist/.rstest-temp'],
          override: false,
        },
        setupFiles: [],
        globalSetup: [],
        plugins: [modifyRstestConfigPlugin],
        resolve: {},
        source: {
          tsconfigPath: join(tempRoot, 'tsconfig.json'),
        },
        output: {
          distPath: {
            root: TEMP_RSTEST_OUTPUT_DIR,
          },
        },
        tools: {},
        testEnvironment: {
          name: 'node',
        },
        performance: {
          buildCache: true,
        },
        coverage: {
          enabled: false,
          exclude: [],
          provider: 'v8',
          reporters: ['text'],
          reportsDirectory: join(tempRoot, 'coverage'),
          clean: true,
          reportOnFailure: false,
          allowExternal: false,
        },
        browser: { enabled: false },
      },
    };

    try {
      const rsbuildInstance = await prepareRsbuild({
        context: {
          rootPath: tempRoot,
          command: 'run',
          normalizedConfig: {
            root: tempRoot,
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
        globTestSourceEntries: async () => ({}),
        setupFileState: createSetupFileState(),
      });

      await rsbuildInstance.initConfigs();

      expect(project.rootPath).toBe(newRoot);
      expect(project.normalizedConfig.source.tsconfigPath).toBe(
        join(newRoot, 'tsconfig.json'),
      );
      expect(project.normalizedConfig.performance?.buildCache).toMatchObject({
        cacheDirectory: join(newRoot, 'node_modules/.cache/rstest-test'),
        buildDependencies: [join(newRoot, 'tsconfig.json')],
      });
      expect(project.normalizedConfig.exclude.patterns).toEqual([
        '**/node_modules/**',
        expect.stringContaining(TEMP_RSTEST_OUTPUT_DIR),
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('should generate rspack config correctly (jsdom)', async () => {
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generate rspack config correctly (node)', async () => {
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generate rspack config correctly with projects', async () => {
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
    expect(bundlerConfigs[1]).toMatchSnapshot();
  });

  it('should respect output.distPath.root in rspack config', async () => {
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(normalize(bundlerConfigs[0]!.output!.path!)).toBe(
      join(rootPath, 'custom/.rstest-temp'),
    );
  });

  it('should use global output.distPath.root for project rspack config', async () => {
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(normalize(bundlerConfigs[0]!.output!.path!)).toBe(
      join(rootPath, 'global/.rstest-temp'),
    );
  });

  it('should generate swc config correctly with user customize', async () => {
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });
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
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

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
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]?.resolve?.conditionNames).toEqual([
      'browser',
      '...',
    ]);
  });

  it('should append user resolve.conditionNames in jsdom environment', async () => {
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

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
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should pass normalized performance.buildCache to rsbuild config', async () => {
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

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

  it('should apply modifyRstestConfig performance.buildCache per project', async () => {
    const modifyCachePlugin = (cacheDigest: string): RsbuildPlugin => ({
      name: `modify-cache-${cacheDigest}`,
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig((config) => {
          config.performance = {
            buildCache: {
              cacheDirectory: `node_modules/.cache/${cacheDigest}`,
              cacheDigest: [cacheDigest],
              buildDependencies: [`${cacheDigest}.config.ts`],
            },
          };
        });
      },
    });

    const rsbuildInstance = await prepareRsbuild({
      context: {
        rootPath,
        command: 'run',
        configFilePath: join(rootPath, 'rstest.config.ts'),
        normalizedConfig: {
          root: rootPath,
          name: 'root',
          output: {
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
          },
          plugins: [],
          resolve: {},
          source: {},
          tools: {},
          testEnvironment: {
            name: 'node',
          },
          isolate: true,
          pool: { type: 'forks' },
        },
        projects: [
          {
            name: 'project-a',
            rootPath,
            environmentName: 'project-a',
            normalizedConfig: {
              root: rootPath,
              name: 'project-a',
              plugins: [modifyCachePlugin('project-a')],
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
          {
            name: 'project-b',
            rootPath,
            environmentName: 'project-b',
            normalizedConfig: {
              root: rootPath,
              name: 'project-b',
              plugins: [modifyCachePlugin('project-b')],
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

    const { origin } = await rsbuildInstance.inspectConfig();
    const environmentConfigs = (origin as any).environmentConfigs;

    expect(environmentConfigs?.['project-a']?.performance?.buildCache).toEqual({
      cacheDirectory: join(rootPath, 'node_modules/.cache/project-a'),
      cacheDigest: [
        'rstest',
        'run',
        'project-a',
        'node',
        'no-coverage',
        TEMP_RSTEST_OUTPUT_DIR,
        'project-a',
      ],
      buildDependencies: [
        join(rootPath, 'rstest.config.ts'),
        join(rootPath, 'project-a.config.ts'),
      ],
    });
    expect(environmentConfigs?.['project-b']?.performance?.buildCache).toEqual({
      cacheDirectory: join(rootPath, 'node_modules/.cache/project-b'),
      cacheDigest: [
        'rstest',
        'run',
        'project-b',
        'node',
        'no-coverage',
        TEMP_RSTEST_OUTPUT_DIR,
        'project-b',
      ],
      buildDependencies: [
        join(rootPath, 'rstest.config.ts'),
        join(rootPath, 'project-b.config.ts'),
      ],
    });
  });

  it('should generate rspack config correctly (esm output)', async () => {
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generate rspack config correctly with less / sass plugin', async () => {
    const { pluginLess } = await import('@rsbuild/plugin-less');
    const { pluginSass } = await import('@rsbuild/plugin-sass');
    const rsbuildInstance = await prepareRsbuild({
      context: {
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
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });
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

  it('should not allow modifyRstestConfig to modify global config fields', async () => {
    const cases = [
      {
        name: 'name',
        modify: (config: Record<string, unknown>) => {
          config.name = 'modified';
        },
      },
      {
        name: 'coverage',
        modify: (config: Record<string, unknown>) => {
          config.coverage = { enabled: true };
        },
      },
      {
        name: 'bail',
        modify: (config: Record<string, unknown>) => {
          config.bail = 1;
        },
      },
      {
        name: 'isolate',
        modify: (config: Record<string, unknown>) => {
          config.isolate = false;
        },
      },
      {
        name: 'onConsoleLog',
        modify: (config: Record<string, unknown>) => {
          config.onConsoleLog = () => false;
        },
      },
      {
        name: 'pool',
        modify: (config: Record<string, unknown>) => {
          config.pool = 'threads';
        },
      },
      {
        name: 'reporters',
        modify: (config: Record<string, unknown>) => {
          config.reporters = ['verbose'];
        },
      },
      {
        name: 'update',
        modify: (config: Record<string, unknown>) => {
          config.update = true;
        },
      },
      {
        name: 'resolveSnapshotPath',
        modify: (config: Record<string, unknown>) => {
          config.resolveSnapshotPath = (testPath: string) => testPath;
        },
      },
      {
        name: 'silent',
        modify: (config: Record<string, unknown>) => {
          config.silent = true;
        },
      },
      {
        name: 'output.distPath',
        modify: (config: Record<string, unknown>) => {
          config.output = { distPath: { root: 'modified' } };
        },
      },
    ];

    for (const { name, modify } of cases) {
      const modifyRstestConfigPlugin: RsbuildPlugin = {
        name: `modify-rstest-config-${name}`,
        setup(api) {
          const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

          rstestApi?.modifyRstestConfig((config) => {
            modify(config as Record<string, unknown>);
          });
        },
      };
      const normalizedConfig = {
        root: rootPath,
        name: 'test',
        output: {
          distPath: {
            root: TEMP_RSTEST_OUTPUT_DIR,
          },
        },
        plugins: [modifyRstestConfigPlugin],
        resolve: {},
        source: {},
        tools: {},
        setupFiles: [],
        testEnvironment: {
          name: 'node',
        },
        coverage: {
          enabled: false,
          exclude: [],
          provider: 'v8',
          reporters: ['text'],
          reportsDirectory: join(rootPath, 'coverage'),
          clean: true,
          reportOnFailure: false,
          allowExternal: false,
        },
        bail: 0,
        isolate: true,
        pool: { type: 'forks' },
        reporters: ['default'],
        silent: false,
        browser: { enabled: false },
      };

      const rsbuildInstance = await prepareRsbuild({
        context: {
          rootPath,
          command: 'run',
          normalizedConfig,
          projects: [
            {
              name: 'test',
              rootPath,
              environmentName: 'test',
              normalizedConfig,
            },
          ],
        } as unknown as RstestContext,
        globTestSourceEntries: async () => ({}),
        setupFileState: createSetupFileState(),
      });

      await expect(rsbuildInstance.initConfigs()).rejects.toThrow(
        `Cannot modify \`${name}\` in \`modifyRstestConfig\``,
      );
    }
  });
});
