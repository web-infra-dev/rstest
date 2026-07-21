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

rs.mock('../../src/core/browserLoader', () => {
  const listBrowserTests = async (
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
          options?.shardedEntries?.get(project.environmentName)?.entries || {},
        ).map((testPath) => ({
          project: project.name,
          testPath,
          tests: [],
        })),
      ),
  });
  const createBrowserExecutor = async (
    context: RstestContext,
    options: { projects: RstestContext['projects'] },
  ) => ({
    name: 'browser',
    projects: options.projects,
    init: async () => undefined,
    runCycle: async () => {
      throw new Error('not used in this test');
    },
    collect: async (opts: {
      shardedEntries?: Map<string, { entries: Record<string, string> }>;
    }) => {
      const { list } = await listBrowserTests(context, opts);
      return { list };
    },
    close: async () => undefined,
  });
  return {
    loadBrowserModule: async () => ({
      validateBrowserConfig: () => undefined,
      createBrowserExecutor,
      runBrowserTests: async () => undefined,
    }),
    loadBrowserExecutor: async (
      context: RstestContext,
      browserProjects: RstestContext['projects'],
    ) => createBrowserExecutor(context, { projects: browserProjects }),
  };
});

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

  it('should expose merged global and project config snapshots', async () => {
    const getterIncludes = new Map<string, string[]>();
    const getterOutput = new Map<
      string,
      { distPath: string | undefined; module: boolean | undefined }
    >();
    const getterPoolTypes = new Map<string, string | undefined>();
    const getterGlobalConfig = new Map<
      string,
      {
        forceRerunTriggers: string[] | undefined;
        onlyFailures: boolean | undefined;
        passWithNoTests: boolean | undefined;
        performance: unknown;
        shard: { count: number; index: number } | undefined;
        silent: boolean | 'passed-only' | undefined;
        update: boolean | undefined;
      }
    >();
    const callbackIncludes = new Map<string, string[] | undefined>();
    const createModifyRstestConfigPlugin = (
      include: string,
    ): RsbuildPlugin => ({
      name: `modify-rstest-config-${include}`,
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        const configSnapshot = rstestApi?.getRstestConfig();
        getterIncludes.set(include, [...(configSnapshot?.include || [])]);
        getterOutput.set(include, {
          distPath:
            typeof configSnapshot?.output?.distPath === 'string'
              ? configSnapshot.output.distPath
              : configSnapshot?.output?.distPath?.root,
          module: configSnapshot?.output?.module,
        });
        const pool = configSnapshot?.pool;
        getterPoolTypes.set(
          include,
          typeof pool === 'string' ? pool : pool?.type,
        );
        getterGlobalConfig.set(include, {
          forceRerunTriggers: configSnapshot?.forceRerunTriggers,
          onlyFailures: configSnapshot?.onlyFailures,
          passWithNoTests: configSnapshot?.passWithNoTests,
          performance: configSnapshot?.performance,
          shard: configSnapshot?.shard,
          silent: configSnapshot?.silent,
          update: configSnapshot?.update,
        });
        configSnapshot?.include?.push('mutated-snapshot');

        rstestApi?.modifyRstestConfig((config) => {
          callbackIncludes.set(include, config.include);
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
        forceRerunTriggers: ['project-a.config.ts'],
        onlyFailures: false,
        plugins: [createModifyRstestConfigPlugin('from-project-a')],
        passWithNoTests: false,
        resolve: {},
        source: {},
        output: { module: false },
        silent: false,
        tools: {},
        update: false,
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
        forceRerunTriggers: ['project-b.config.ts'],
        onlyFailures: false,
        plugins: [createModifyRstestConfigPlugin('from-project-b')],
        passWithNoTests: false,
        resolve: {},
        source: {},
        output: { module: true },
        silent: false,
        tools: {},
        update: false,
        testEnvironment: {
          name: 'node',
        },
        browser: { enabled: false },
      },
    };

    const context = {
      rootPath,
      command: 'run',
      originalConfig: {},
      normalizedConfig: {
        root: rootPath,
        name: 'test',
        forceRerunTriggers: ['root.config.ts'],
        include: ['global-original'],
        onlyFailures: true,
        passWithNoTests: true,
        performance: { buildCache: false },
        shard: { count: 2, index: 1 },
        silent: 'passed-only',
        update: true,
        output: {
          distPath: {
            root: TEMP_RSTEST_OUTPUT_DIR,
          },
        },
        pool: { type: 'threads' },
      },
      projects: [projectA, projectB],
    } as unknown as RstestContext;

    const rsbuildInstance = await prepareRsbuild({
      context,
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

    await rsbuildInstance.initConfigs();

    expect(getterIncludes.get('from-project-a')).toEqual(['original-a']);
    expect(getterIncludes.get('from-project-b')).toEqual(['original-b']);
    expect(getterPoolTypes.get('from-project-a')).toBe('threads');
    expect(getterPoolTypes.get('from-project-b')).toBe('threads');
    expect(getterGlobalConfig.get('from-project-a')).toEqual({
      forceRerunTriggers: ['root.config.ts', 'project-a.config.ts'],
      onlyFailures: true,
      passWithNoTests: true,
      performance: undefined,
      shard: { count: 2, index: 1 },
      silent: 'passed-only',
      update: true,
    });
    expect(getterGlobalConfig.get('from-project-b')).toEqual({
      forceRerunTriggers: ['root.config.ts', 'project-b.config.ts'],
      onlyFailures: true,
      passWithNoTests: true,
      performance: undefined,
      shard: { count: 2, index: 1 },
      silent: 'passed-only',
      update: true,
    });
    expect(getterOutput.get('from-project-a')).toEqual({
      distPath: TEMP_RSTEST_OUTPUT_DIR,
      module: false,
    });
    expect(getterOutput.get('from-project-b')).toEqual({
      distPath: TEMP_RSTEST_OUTPUT_DIR,
      module: true,
    });
    expect(callbackIncludes.get('from-project-a')).toEqual(['original-a']);
    expect(callbackIncludes.get('from-project-b')).toEqual(['original-b']);
    expect(context.normalizedConfig.include).toEqual(['global-original']);
    expect(projectA.normalizedConfig.include).toEqual(['from-project-a']);
    expect(projectB.normalizedConfig.include).toEqual(['from-project-b']);
  });

  it('should preserve opaque values in exposed config', async () => {
    class ProviderOption {
      #value = 'original';

      getValue() {
        return this.#value;
      }
    }

    const providerOption = new ProviderOption();
    const providerCallback = () => 'original';
    const providerPromise = Promise.resolve('original');
    const providerUrl = new URL('https://rstest.rs/guide');
    const providerBytes = new Uint8Array([1, 2, 3]);
    const testNamePattern = /original/g;
    type ProviderOptions = {
      bytes: Uint8Array;
      callback: typeof providerCallback;
      option: ProviderOption;
      promise: Promise<string>;
      url: URL;
    };
    let exposedProviderOptions: ProviderOptions | undefined;
    let exposedBundlePattern: RegExp | string | undefined;
    const readConfigPlugin: RsbuildPlugin = {
      name: 'read-opaque-rstest-config',
      setup(api) {
        const snapshot = api
          .useExposed<RstestExposeAPI>('rstest')
          ?.getRstestConfig();
        exposedProviderOptions = snapshot?.browser
          ?.providerOptions as ProviderOptions;
        exposedBundlePattern = Array.isArray(
          snapshot?.output?.bundleDependencies,
        )
          ? snapshot.output.bundleDependencies[0]
          : undefined;
      },
    };
    const project = {
      name: 'browser-project',
      rootPath,
      environmentName: 'browser-project',
      normalizedConfig: {
        forceRerunTriggers: [],
        include: ['original.test.ts'],
        plugins: [readConfigPlugin],
        resolve: {},
        source: {},
        output: { bundleDependencies: [testNamePattern] },
        tools: {},
        testEnvironment: { name: 'node' },
        browser: {
          enabled: false,
          providerOptions: {
            bytes: providerBytes,
            callback: providerCallback,
            option: providerOption,
            promise: providerPromise,
            url: providerUrl,
          },
        },
      },
    };
    const context = {
      rootPath,
      command: 'run',
      originalConfig: {},
      normalizedConfig: {
        forceRerunTriggers: [],
        output: { distPath: { root: TEMP_RSTEST_OUTPUT_DIR } },
        pool: { execArgv: [], type: 'forks' },
      },
      projects: [project],
    } as unknown as RstestContext;
    const rsbuildInstance = await prepareRsbuild({
      context,
      globTestSourceEntries: async () => ({}),
      setupFileState: createSetupFileState(),
    });

    await rsbuildInstance.initConfigs();

    expect(exposedBundlePattern).toBe(testNamePattern);
    expect(exposedProviderOptions?.option).toBe(providerOption);
    expect(exposedProviderOptions?.option.getValue()).toBe('original');
    expect(exposedProviderOptions?.callback).toBe(providerCallback);
    expect(exposedProviderOptions?.callback()).toBe('original');
    expect(exposedProviderOptions?.promise).toBe(providerPromise);
    await expect(exposedProviderOptions?.promise).resolves.toBe('original');
    expect(exposedProviderOptions?.url).toBe(providerUrl);
    expect(exposedProviderOptions?.url.href).toBe('https://rstest.rs/guide');
    expect(exposedProviderOptions?.bytes).toBe(providerBytes);
    expect(exposedProviderOptions?.bytes.byteLength).toBe(3);
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
          setupFiles: ['./setup.ts'],
          globalSetup: ['./globalSetup.ts'],
          includeSource: ['./new-src.ts'],
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
        includeSource: ['original-src.ts'],
        setupFiles: ['original-setup.ts'],
        globalSetup: ['original-globalSetup.ts'],
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
      expect(project.normalizedConfig.includeSource).toEqual(['./new-src.ts']);
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

  it('should expand root placeholders after modifyRstestConfig changes path fields', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'rstest-root-placeholder-'));
    for (const file of ['setup.ts', 'globalSetup.ts']) {
      writeFileSync(join(tempRoot, file), 'export {}\n');
    }

    const modifyRstestConfigPlugin: RsbuildPlugin = {
      name: 'modify-rstest-config-root-placeholders',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig(() => ({
          include: ['<rootDir>/src/**/*.test.ts'],
          exclude: ['<rootDir>/src/ignored.test.ts'],
          setupFiles: ['<rootDir>/setup.ts'],
          globalSetup: ['<rootDir>/globalSetup.ts'],
          includeSource: ['<rootDir>/src/**/*.ts'],
        }));
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
        setupFiles: [],
        globalSetup: [],
        includeSource: [],
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
      const setupFileState = createSetupFileState();
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
        setupFileState,
      });

      await rsbuildInstance.initConfigs();

      expect(project.normalizedConfig.include).toEqual([
        join(tempRoot, 'src/**/*.test.ts'),
      ]);
      expect(project.normalizedConfig.exclude.patterns).toEqual([
        '**/node_modules/**',
        join(tempRoot, 'src/ignored.test.ts'),
        expect.stringContaining(TEMP_RSTEST_OUTPUT_DIR),
      ]);
      expect(project.normalizedConfig.setupFiles).toEqual([
        join(tempRoot, 'setup.ts'),
      ]);
      expect(project.normalizedConfig.globalSetup).toEqual([
        join(tempRoot, 'globalSetup.ts'),
      ]);
      expect(project.normalizedConfig.includeSource).toEqual([
        join(tempRoot, 'src/**/*.ts'),
      ]);
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

  it('should preserve explicit tsconfigPath after modifyRstestConfig changes root', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'rstest-root-tsconfig-'));
    const newRoot = join(tempRoot, 'fixture');
    const customTsconfigPath = join(newRoot, 'tsconfig.custom.json');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(join(tempRoot, 'tsconfig.json'), '{}\n');
    writeFileSync(join(newRoot, 'tsconfig.json'), '{}\n');
    writeFileSync(customTsconfigPath, '{}\n');

    const modifyRstestConfigPlugin: RsbuildPlugin = {
      name: 'modify-rstest-config-root-custom-tsconfig',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig((config) => {
          config.root = './fixture';
          config.source = {
            tsconfigPath: customTsconfigPath,
          };
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
        customTsconfigPath,
      );
      expect(project.normalizedConfig.performance?.buildCache).toMatchObject({
        cacheDirectory: join(newRoot, 'node_modules/.cache/rstest-test'),
        buildDependencies: [customTsconfigPath],
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('should normalize relative tsconfigPath after modifyRstestConfig changes source', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'rstest-relative-tsconfig-'));
    const customTsconfigPath = join(tempRoot, 'tsconfig.custom.json');
    writeFileSync(join(tempRoot, 'tsconfig.json'), '{}\n');
    writeFileSync(customTsconfigPath, '{}\n');

    const modifyRstestConfigPlugin: RsbuildPlugin = {
      name: 'modify-rstest-config-relative-tsconfig',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');

        rstestApi?.modifyRstestConfig((config) => {
          config.source = {
            tsconfigPath: './tsconfig.custom.json',
          };
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

      expect(project.normalizedConfig.source.tsconfigPath).toBe(
        customTsconfigPath,
      );
      expect(project.normalizedConfig.performance?.buildCache).toMatchObject({
        buildDependencies: [customTsconfigPath],
      });
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

  it('should not allow modifyRstestConfig to modify high-risk config fields', async () => {
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
        name: 'isolate',
        modify: (config: Record<string, unknown>) => {
          config.isolate = false;
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
        name: 'forceRerunTriggers',
        modify: (config: Record<string, unknown>) => {
          config.forceRerunTriggers = ['custom.config.ts'];
        },
      },
      {
        name: 'shard',
        modify: (config: Record<string, unknown>) => {
          config.shard = { index: 1, count: 2 };
        },
      },
      {
        name: 'output.distPath',
        modify: (config: Record<string, unknown>) => {
          config.output = { distPath: { root: 'modified' } };
        },
      },
      {
        name: 'plugins',
        modify: (config: Record<string, unknown>) => {
          config.plugins = [];
        },
      },
      {
        name: 'extends',
        modify: (config: Record<string, unknown>) => {
          config.extends = ['base'];
        },
      },
      {
        name: 'projects',
        modify: (config: Record<string, unknown>) => {
          config.projects = [];
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
