import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RsbuildDevServer, RsbuildInstance } from '@rsbuild/core';
import { createRsbuild, rspack } from '@rsbuild/core';
import { dirname, join, relative, resolve, sep } from 'pathe';
import type { Rstest } from '../core/rstest';
import type {
  ProjectContext,
  Reporter,
  RuntimeConfig,
  TestFileResult,
  TestResult,
} from '../types';
import {
  color,
  logger,
  serializableConfig,
  TEMP_RSTEST_OUTPUT_DIR,
} from '../utils';
import { getSetupFiles, getTestEntries } from '../utils/testFiles';
import type {
  BrowserClientMessage,
  BrowserHostConfig,
  BrowserManifestEntry,
  BrowserProjectRuntime,
} from './protocol';

const __dirname = dirname(fileURLToPath(import.meta.url));

type VirtualModulesPluginInstance = InstanceType<
  (typeof rspack.experiments)['VirtualModulesPlugin']
>;

type PlaywrightModule = typeof import('playwright-core');
type ChromiumLauncher = PlaywrightModule['chromium'];
type ChromiumBrowserInstance = Awaited<ReturnType<ChromiumLauncher['launch']>>;

type BrowserProjectEntries = {
  project: ProjectContext;
  setupFiles: string[];
  testFiles: string[];
};

const ensureProcessExitCode = (code: number) => {
  if (process.exitCode === undefined || process.exitCode === 0) {
    process.exitCode = code;
  }
};

const toPosix = (path: string): string => path.split(sep).join('/');

const getRuntimeConfigFromProject = (
  project: ProjectContext,
): RuntimeConfig => {
  const {
    testNamePattern,
    testTimeout,
    passWithNoTests,
    retry,
    globals,
    clearMocks,
    resetMocks,
    restoreMocks,
    unstubEnvs,
    unstubGlobals,
    maxConcurrency,
    printConsoleTrace,
    disableConsoleIntercept,
    testEnvironment,
    hookTimeout,
    isolate,
    coverage,
    snapshotFormat,
    env,
  } = project.normalizedConfig;

  return {
    env,
    testNamePattern,
    testTimeout,
    hookTimeout,
    passWithNoTests,
    retry,
    globals,
    clearMocks,
    resetMocks,
    restoreMocks,
    unstubEnvs,
    unstubGlobals,
    maxConcurrency,
    printConsoleTrace,
    disableConsoleIntercept,
    testEnvironment,
    isolate,
    coverage,
    snapshotFormat,
  };
};

const collectProjectEntries = async (
  context: Rstest,
): Promise<BrowserProjectEntries[]> => {
  const projectEntries: BrowserProjectEntries[] = [];

  for (const project of context.projects) {
    const {
      normalizedConfig: { include, exclude, includeSource, setupFiles },
    } = project;

    const tests = await getTestEntries({
      include,
      exclude: exclude.patterns,
      includeSource,
      rootPath: context.rootPath,
      projectRoot: project.rootPath,
      fileFilters: context.fileFilters || [],
    });

    const setup = getSetupFiles(setupFiles, project.rootPath);

    projectEntries.push({
      project,
      setupFiles: Object.values(setup),
      testFiles: Object.values(tests),
    });
  }

  return projectEntries;
};

const resolveBrowserFile = (relativePath: string): string => {
  const candidates = [
    resolve(__dirname, relativePath),
    resolve(__dirname, '../src/browser', relativePath),
    resolve(__dirname, '../../src/browser', relativePath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve browser client file: ${relativePath}`);
};

const generateManifestModule = ({
  manifestPath,
  entries,
}: {
  manifestPath: string;
  entries: BrowserProjectEntries[];
}): string => {
  const manifestDirPosix = toPosix(dirname(manifestPath));

  const toRelativeImport = (filePath: string): string => {
    const posixPath = toPosix(filePath);
    let relativePath = relative(manifestDirPosix, posixPath);
    if (!relativePath.startsWith('.')) {
      relativePath = `./${relativePath}`;
    }
    // normalize to posix for import path
    return relativePath.split(sep).join('/');
  };

  let index = 0;

  const lines: string[] = [];
  lines.push('export const manifest = [');

  for (const { project, setupFiles, testFiles } of entries) {
    setupFiles.forEach((filePath) => {
      const id = `${project.environmentName}-setup-${index++}`;
      const record: BrowserManifestEntry = {
        id,
        type: 'setup',
        projectName: project.name,
        projectRoot: project.rootPath,
        filePath,
        relativePath: toRelativeImport(filePath),
      };

      lines.push(
        '  {',
        `    id: ${JSON.stringify(record.id)},`,
        `    type: 'setup',`,
        `    projectName: ${JSON.stringify(record.projectName)},`,
        `    projectRoot: ${JSON.stringify(toPosix(record.projectRoot))},`,
        `    filePath: ${JSON.stringify(toPosix(record.filePath))},`,
        `    relativePath: ${JSON.stringify(record.relativePath)},`,
        `    load: () => import(${JSON.stringify(record.relativePath)}),`,
        '  },',
      );
    });

    testFiles.forEach((filePath) => {
      const id = `${project.environmentName}-test-${index++}`;
      const record: BrowserManifestEntry = {
        id,
        type: 'test',
        projectName: project.name,
        projectRoot: project.rootPath,
        filePath,
        relativePath: toRelativeImport(filePath),
        testPath: filePath,
      };
      lines.push(
        '  {',
        `    id: ${JSON.stringify(record.id)},`,
        `    type: 'test',`,
        `    projectName: ${JSON.stringify(record.projectName)},`,
        `    projectRoot: ${JSON.stringify(toPosix(record.projectRoot))},`,
        `    filePath: ${JSON.stringify(toPosix(record.filePath))},`,
        `    testPath: ${JSON.stringify(toPosix(record.testPath!))},`,
        `    relativePath: ${JSON.stringify(record.relativePath)},`,
        `    load: () => import(${JSON.stringify(record.relativePath)}),`,
        '  },',
      );
    });
  }

  lines.push('] as const;');

  return `${lines.join('\n')}\n`;
};

const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Rstest Browser Runner</title>
  </head>
  <body>
    <script type="module" src="/static/js/runner.js"></script>
  </body>
</html>
`;

type BrowserRuntime = {
  rsbuildInstance: RsbuildInstance;
  devServer: RsbuildDevServer;
  browser: ChromiumBrowserInstance;
  port: number;
  manifestPath: string;
  tempDir: string;
  manifestPlugin: VirtualModulesPluginInstance;
};

let sharedRuntime: BrowserRuntime | null = null;
let watchCleanupRegistered = false;
let isRerunning = false;
let lastTestFiles: string[] = [];
let enableWatchHooks = false; // Flag to control if watch hooks should execute

const destroyBrowserRuntime = async (
  runtime: BrowserRuntime,
): Promise<void> => {
  try {
    await runtime.browser?.close?.();
  } catch {
    // ignore
  }
  try {
    await runtime.devServer?.close?.();
  } catch {
    // ignore
  }
  await fs
    .rm(runtime.tempDir, { recursive: true, force: true })
    .catch(() => {});
};

const registerWatchCleanup = () => {
  if (watchCleanupRegistered) {
    return;
  }

  const cleanup = async () => {
    if (!sharedRuntime) {
      return;
    }
    await destroyBrowserRuntime(sharedRuntime);
    sharedRuntime = null;
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void cleanup();
    });
  }

  process.once('exit', () => {
    void cleanup();
  });

  watchCleanupRegistered = true;
};

const createBrowserRuntime = async ({
  context,
  manifestPath,
  manifestSource,
  tempDir,
  isWatchMode,
  onTriggerRerun,
}: {
  context: Rstest;
  manifestPath: string;
  manifestSource: string;
  tempDir: string;
  isWatchMode: boolean;
  onTriggerRerun?: () => Promise<void>;
}): Promise<BrowserRuntime> => {
  const virtualManifestPlugin = new rspack.experiments.VirtualModulesPlugin({
    [manifestPath]: manifestSource,
  });

  const rsbuildInstance = await createRsbuild({
    callerName: 'rstest-browser',
    rsbuildConfig: {
      root: context.rootPath,
      mode: 'development',
      server: {
        printUrls: false,
      },
      environments: {
        web: {
          source: {
            entry: {
              runner: resolveBrowserFile('client/entry.ts'),
            },
            alias: {
              '@rstest/browser-manifest': manifestPath,
              '@rstest/core': resolveBrowserFile('client/public.ts'),
              '@sinonjs/fake-timers': resolveBrowserFile(
                'client/fakeTimersStub.ts',
              ),
            },
          },
          output: {
            target: 'web',
          },
          tools: {
            rspack: (config) => {
              config.mode = 'development';
              config.devtool = 'source-map';
              config.plugins = config.plugins || [];
              config.plugins.push(virtualManifestPlugin);
            },
          },
        },
      },
    },
  });

  // Register watch plugin if in watch mode
  if (isWatchMode && onTriggerRerun) {
    rsbuildInstance.addPlugins([
      {
        name: 'rstest:browser-watch',
        setup(api) {
          // Use onBeforeDevCompile to show message
          api.onBeforeDevCompile(() => {
            if (!enableWatchHooks) {
              return;
            }
            logger.log(color.cyan('\nFile changed, re-running tests...\n'));
          });

          // Use onAfterDevCompile to trigger test rerun
          api.onAfterDevCompile(async () => {
            if (!enableWatchHooks) {
              return;
            }

            // Skip if we're currently rerunning
            if (isRerunning) {
              return;
            }

            // Trigger test rerun
            await onTriggerRerun();
          });
        },
      },
    ]);
  }

  const devServer = await rsbuildInstance.createDevServer({
    getPortSilently: true,
  });

  devServer.middlewares.use((req, res, next) => {
    if (!req.url) {
      next();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/runner.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end(htmlTemplate);
      return;
    }
    next();
  });

  const { port } = await devServer.listen();

  let chromiumLauncher: ChromiumLauncher;
  try {
    ({ chromium: chromiumLauncher } = await import('playwright-core'));
  } catch (_error) {
    await devServer.close();
    throw _error;
  }

  let browser: ChromiumBrowserInstance;
  try {
    browser = await chromiumLauncher.launch({
      headless: context.normalizedConfig.browser.headless,
    });
  } catch (_error) {
    await devServer.close();
    throw _error;
  }

  return {
    rsbuildInstance,
    devServer,
    browser,
    port,
    manifestPath,
    tempDir,
    manifestPlugin: virtualManifestPlugin,
  };
};

/**
 * Execute a single test file in an isolated browser context
 */
const executeSingleTestFile = async ({
  browser,
  port,
  testFile,
  context,
}: {
  browser: ChromiumBrowserInstance;
  port: number;
  testFile: string;
  context: Rstest;
}): Promise<{
  reporterResults: TestFileResult[];
  caseResults: TestResult[];
  fatalError: Error | null;
}> => {
  const reporterResults: TestFileResult[] = [];
  const caseResults: TestResult[] = [];
  let fatalError: Error | null = null;

  // Create isolated context and page for this test file
  const browserContext = await browser.newContext();
  const page = await browserContext.newPage();

  try {
    const projectRuntimeConfigs: BrowserProjectRuntime[] =
      context.projects.map((project: ProjectContext) => ({
        name: project.name,
        environmentName: project.environmentName,
        projectRoot: project.rootPath,
        runtimeConfig: serializableConfig(getRuntimeConfigFromProject(project)),
      }));

    const hostOptions: BrowserHostConfig = {
      rootPath: context.rootPath,
      projects: projectRuntimeConfigs,
      snapshot: {
        updateSnapshot: context.snapshotManager.options.updateSnapshot,
      },
      testFile, // Specify which test file to run
    };

    await page.addInitScript((options: BrowserHostConfig) => {
      (window as any).__RSTEST_BROWSER_OPTIONS__ = options;
    }, hostOptions);

    let resolveRun: (() => void) | undefined;
    const runPromise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const completeRun = () => {
      if (resolveRun) {
        resolveRun();
        resolveRun = undefined;
      }
    };

    await page.exposeBinding(
      '__rstest_dispatch__',
      async (_source: unknown, payload: BrowserClientMessage) => {
        switch (payload.type) {
          case 'ready':
            return;
          case 'file-start': {
            await Promise.all(
              context.reporters.map((reporter) =>
                (reporter as Reporter).onTestFileStart?.({
                  testPath: payload.payload.testPath,
                }),
              ),
            );
            break;
          }
          case 'case-result': {
            caseResults.push(payload.payload);
            await Promise.all(
              context.reporters.map((reporter) =>
                (reporter as Reporter).onTestCaseResult?.(payload.payload),
              ),
            );
            break;
          }
          case 'file-complete': {
            reporterResults.push(payload.payload);
            if (payload.payload.snapshotResult) {
              context.snapshotManager.add(payload.payload.snapshotResult);
            }
            await Promise.all(
              context.reporters.map((reporter) =>
                (reporter as Reporter).onTestFileResult?.(payload.payload),
              ),
            );
            break;
          }
          case 'log': {
            logger.log(payload.payload.message);
            break;
          }
          case 'fatal': {
            fatalError = new Error(payload.payload.message);
            fatalError.stack = payload.payload.stack;
            completeRun();
            break;
          }
          case 'complete':
            completeRun();
            break;
        }
      },
    );

    await page.goto(`http://localhost:${port}/runner.html`, {
      waitUntil: 'load',
    });
    await runPromise;
  } catch (error) {
    if (!fatalError) {
      fatalError = error instanceof Error ? error : new Error(String(error));
    }
  } finally {
    // Clean up page and context
    await page.close().catch(() => {});
    await browserContext.close().catch(() => {});
  }

  return { reporterResults, caseResults, fatalError };
};

export const runBrowserController = async (context: Rstest): Promise<void> => {
  const buildStart = Date.now();
  const projectEntries = await collectProjectEntries(context);
  const totalTests = projectEntries.reduce(
    (total, item) => total + item.testFiles.length,
    0,
  );

  if (totalTests === 0) {
    const code = context.normalizedConfig.passWithNoTests ? 0 : 1;
    logger.log(
      color[code ? 'red' : 'yellow'](
        `No test files found, exiting with code ${code}.`,
      ),
    );
    if (code !== 0) {
      ensureProcessExitCode(code);
    }
    return;
  }

  const isWatchMode = context.command === 'watch';
  const tempDir =
    isWatchMode && sharedRuntime
      ? sharedRuntime.tempDir
      : isWatchMode
        ? join(context.rootPath, TEMP_RSTEST_OUTPUT_DIR, 'browser', 'watch')
        : join(
            context.rootPath,
            TEMP_RSTEST_OUTPUT_DIR,
            'browser',
            Date.now().toString(),
          );
  const manifestPath = join(tempDir, 'manifest.ts');

  const manifestSource = generateManifestModule({
    manifestPath,
    entries: projectEntries,
  });

  if (isWatchMode && sharedRuntime) {
    sharedRuntime.manifestPlugin.writeModule(manifestPath, manifestSource);
  }

  // Track initial test files for watch mode
  if (isWatchMode) {
    lastTestFiles = projectEntries.flatMap((entry) => entry.testFiles).sort();
  }

  let runtime = isWatchMode ? sharedRuntime : null;

  // Define rerun callback for watch mode (will be populated later)
  let triggerRerun: (() => Promise<void>) | undefined;

  // Create a wrapper that will call triggerRerun when it's available
  const onTriggerRerun = async () => {
    if (triggerRerun) {
      await triggerRerun();
    }
  };

  if (!runtime || !isWatchMode) {
    try {
      runtime = await createBrowserRuntime({
        context,
        manifestPath,
        manifestSource,
        tempDir,
        isWatchMode,
        onTriggerRerun: isWatchMode ? onTriggerRerun : undefined,
      });
    } catch (_error) {
      logger.error(
        color.red(
          'Failed to load Playwright. Please install "playwright-core" to use browser mode.',
        ),
      );
      ensureProcessExitCode(1);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return;
    }

    if (isWatchMode) {
      sharedRuntime = runtime;
      registerWatchCleanup();
    }
  }

  const { browser, port } = runtime!;
  const buildTime = Date.now() - buildStart;

  // Collect all test files from project entries
  const allTestFiles = projectEntries.flatMap((entry) => entry.testFiles);

  // Extracted test execution logic for reuse - now runs tests in parallel
  const executeTests = async (): Promise<{
    reporterResults: TestFileResult[];
    caseResults: TestResult[];
    fatalError: Error | null;
    testTime: number;
  }> => {
    const runStart = Date.now();

    // Execute all test files in parallel, each in its own isolated context
    const results = await Promise.all(
      allTestFiles.map((testFile) =>
        executeSingleTestFile({
          browser,
          port,
          testFile,
          context,
        }),
      ),
    );

    // Aggregate results from all test files
    const reporterResults: TestFileResult[] = [];
    const caseResults: TestResult[] = [];
    let fatalError: Error | null = null;

    for (const result of results) {
      reporterResults.push(...result.reporterResults);
      caseResults.push(...result.caseResults);
      if (result.fatalError && !fatalError) {
        fatalError = result.fatalError;
      }
    }

    const testTime = Date.now() - runStart;
    return { reporterResults, caseResults, fatalError, testTime };
  };

  // Define rerun logic for watch mode
  if (isWatchMode) {
    triggerRerun = async () => {
      // Set flag to prevent infinite loop
      isRerunning = true;

      // Re-collect test entries (may have new/deleted files)
      const newProjectEntries = await collectProjectEntries(context);

      // Get current test file list
      const currentTestFiles = newProjectEntries
        .flatMap((entry) => entry.testFiles)
        .sort();

      // Check if test file list changed
      const filesChanged =
        currentTestFiles.length !== lastTestFiles.length ||
        currentTestFiles.some((file, index) => file !== lastTestFiles[index]);

      if (filesChanged) {
        // Update last test files
        lastTestFiles = currentTestFiles;

        // Regenerate manifest only if files changed
        const newManifestSource = generateManifestModule({
          manifestPath,
          entries: newProjectEntries,
        });
        runtime!.manifestPlugin.writeModule(manifestPath, newManifestSource);

        // Don't execute tests here - let the onAfterDevCompile hook handle it
        // after manifest recompilation. Just clear the flag after a delay.
        setTimeout(() => {
          isRerunning = false;
        }, 1000);
        return;
      }

      // No file list changes, just execute tests
      isRerunning = false;

      // Execute tests
      const { reporterResults, caseResults, fatalError, testTime } =
        await executeTests();

      if (fatalError) {
        logger.error(
          color.red(`Browser test run failed: ${fatalError.message}`),
        );
        ensureProcessExitCode(1);
        return;
      }

      const duration = {
        totalTime: testTime,
        buildTime: 0,
        testTime,
      };

      context.updateReporterResultState(reporterResults, caseResults);

      const isFailure = reporterResults.some(
        (result) => result.status === 'fail',
      );
      if (isFailure) {
        ensureProcessExitCode(1);
      }

      for (const reporter of context.reporters) {
        await reporter.onTestRunEnd?.({
          results: context.reporterResults.results,
          testResults: context.reporterResults.testResults,
          duration,
          snapshotSummary: context.snapshotManager.summary,
          getSourcemap: async () => null,
        });
      }
    };
  }

  // Execute initial test run
  const { reporterResults, caseResults, fatalError, testTime } =
    await executeTests();

  if (!isWatchMode) {
    await destroyBrowserRuntime(runtime!);
  }

  if (fatalError) {
    logger.error(color.red(`Browser test run failed: ${fatalError.message}`));
    ensureProcessExitCode(1);
    return;
  }

  const duration = {
    totalTime: buildTime + testTime,
    buildTime,
    testTime,
  };

  context.updateReporterResultState(reporterResults, caseResults);

  const isFailure = reporterResults.some((result) => result.status === 'fail');
  if (isFailure) {
    ensureProcessExitCode(1);
  }

  for (const reporter of context.reporters) {
    await reporter.onTestRunEnd?.({
      results: context.reporterResults.results,
      testResults: context.reporterResults.testResults,
      duration,
      snapshotSummary: context.snapshotManager.summary,
      getSourcemap: async () => null,
    });
  }

  // Enable watch hooks AFTER initial test run to avoid duplicate runs
  if (isWatchMode && triggerRerun) {
    enableWatchHooks = true;
    logger.log(
      color.cyan('\nWatch mode enabled - will re-run tests on file changes\n'),
    );
  }
};
