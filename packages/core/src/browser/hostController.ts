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

const containerHtmlTemplate = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Rstest Browser Test Runner</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        height: 100vh;
        overflow: hidden;
      }
      
      .container {
        display: flex;
        height: 100vh;
      }
      
      .sidebar {
        width: 280px;
        background: #f5f5f5;
        border-right: 1px solid #ddd;
        display: flex;
        flex-direction: column;
      }
      
      .header {
        padding: 16px;
        border-bottom: 1px solid #ddd;
        background: #fff;
      }
      
      .header h2 {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 12px;
        color: #333;
      }
      
      .rerun-btn {
        width: 100%;
        padding: 8px 16px;
        background: #0066cc;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      }
      
      .rerun-btn:hover {
        background: #0052a3;
      }
      
      .rerun-btn:active {
        background: #003d7a;
      }
      
      .test-file-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }
      
      .test-file-tab {
        padding: 10px 12px;
        margin-bottom: 4px;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        color: #333;
        word-break: break-all;
        transition: all 0.15s;
      }
      
      .test-file-tab:hover {
        background: #e8f4ff;
        border-color: #0066cc;
      }
      
      .test-file-tab.active {
        background: #0066cc;
        color: white;
        border-color: #0066cc;
        font-weight: 500;
      }
      
      .main {
        flex: 1;
        position: relative;
        background: #fff;
      }
      
      .iframe-container {
        width: 100%;
        height: 100%;
        position: relative;
      }
      
      .test-runner-iframe {
        width: 100%;
        height: 100%;
        border: none;
        position: absolute;
        top: 0;
        left: 0;
      }
    </style>
  </head>
  <body>
    <script type="module" src="/static/js/container.js"></script>
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
  containerPage?: any; // Playwright Page instance
  containerContext?: any; // Playwright BrowserContext instance
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
              container: resolveBrowserFile('client/containerEntry.ts'),
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
              config.experiments = {
                ...config.experiments,
                lazyCompilation: {
                  // Only compile dynamic imports when they are actually requested
                  imports: true,
                  // Don't lazy compile entry modules
                  entries: false,
                },
              };
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
    if (url.pathname === '/' || url.pathname === '/container.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end(containerHtmlTemplate);
      return;
    }
    if (url.pathname === '/runner.html') {
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
      args: [
        '--disable-popup-blocking',
        '--no-first-run',
        '--no-default-browser-check',
      ],
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

  // Track test results from iframes
  const reporterResults: TestFileResult[] = [];
  const caseResults: TestResult[] = [];
  let completedTests = 0;
  let fatalError: Error | null = null;

  // Promise that resolves when all tests complete
  let resolveAllTests: (() => void) | undefined;
  const allTestsPromise = new Promise<void>((resolve) => {
    resolveAllTests = resolve;
  });

  // Open a container page for user to view (reuse in watch mode)
  let containerContext: any;
  let containerPage: any;
  let isNewPage = false; // Track if we created a new page

  if (isWatchMode && runtime!.containerPage && runtime!.containerContext) {
    // Reuse existing container page in watch mode
    containerContext = runtime!.containerContext;
    containerPage = runtime!.containerPage;
    logger.log(color.gray('\n[Watch] Reusing existing container page\n'));
  } else {
    // Create new container page
    isNewPage = true;
    containerContext = await browser.newContext();
    containerPage = await containerContext.newPage();

    // Prevent popup windows from being created
    containerPage.on('popup', async (popup: any) => {
      await popup.close().catch(() => {});
    });

    // Also prevent popups from the context level
    containerContext.on('page', async (page: any) => {
      // Close any new pages that aren't the container page
      if (page !== containerPage) {
        await page.close().catch(() => {});
      }
    });

    // Save to runtime for reuse in watch mode
    if (isWatchMode) {
      runtime!.containerPage = containerPage;
      runtime!.containerContext = containerContext;
    }

    // Setup communication to receive test results from iframes (only on first creation)
    await containerPage.exposeBinding(
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

            completedTests++;
            if (completedTests >= allTestFiles.length && resolveAllTests) {
              resolveAllTests();
            }
            break;
          }
          case 'log': {
            logger.log(payload.payload.message);
            break;
          }
          case 'fatal': {
            fatalError = new Error(payload.payload.message);
            fatalError.stack = payload.payload.stack;
            if (resolveAllTests) {
              resolveAllTests();
            }
            break;
          }
          case 'complete':
            // Individual iframe completed, not all tests
            break;
        }
      },
    );

    // Setup birpc for container control
    await containerPage.exposeBinding(
      '__rstest_container_dispatch__',
      async (_source: unknown, data: any) => {
        postToContainer?.(data);
      },
    );

    // Forward browser console to terminal
    containerPage.on('console', (msg: any) => {
      const text = msg.text();
      if (text.includes('[Container]') || text.includes('[Runner]')) {
        logger.log(color.gray(`[Browser Console] ${text}`));
      }
    });
  }

  // Birpc setup (need to recreate on each run to capture current context)
  let containerRpc: any = null;
  let postToContainer: ((data: any) => void) | null = null;

  const containerMethods = {
    async rerunTest(testFile: string) {
      logger.log(color.cyan(`\nRe-running test: ${testFile}\n`));
      // TODO: Implement rerun by reloading the specific iframe
      logger.log(color.yellow('Re-run functionality not yet implemented'));
    },

    async getTestFiles() {
      return allTestFiles;
    },
  };

  const { createBirpc } = await import('birpc');

  containerRpc = createBirpc(containerMethods, {
    post: (data) => {
      containerPage
        ?.evaluate((msg: any) => {
          (window as any).__rstest_container_on__?.(msg);
        }, data)
        .catch(() => {});
    },
    on: (fn) => {
      postToContainer = fn;
    },
  });

  // Only navigate and setup on first creation (new page)
  if (isNewPage) {
    // Inject test configuration for runner pages
    const projectRuntimeConfigs: BrowserProjectRuntime[] = context.projects.map(
      (project: ProjectContext) => ({
        name: project.name,
        environmentName: project.environmentName,
        projectRoot: project.rootPath,
        runtimeConfig: serializableConfig(getRuntimeConfigFromProject(project)),
      }),
    );

    const hostOptions: BrowserHostConfig = {
      rootPath: context.rootPath,
      projects: projectRuntimeConfigs,
      snapshot: {
        updateSnapshot: context.snapshotManager.options.updateSnapshot,
      },
    };

    await containerPage.addInitScript((options: BrowserHostConfig) => {
      (window as any).__RSTEST_BROWSER_OPTIONS__ = options;
    }, hostOptions);

    // Navigate to container page
    await containerPage.goto(`http://localhost:${port}/container.html`, {
      waitUntil: 'load',
    });

    logger.log(
      color.cyan(
        `\nContainer page opened at http://localhost:${port}/container.html\n`,
      ),
    );
  }

  // Wait for all tests to complete
  const testTimeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.log(
        color.yellow(
          `\nTest execution timeout after 60s. Completed: ${completedTests}/${allTestFiles.length}\n`,
        ),
      );
      resolve();
    }, 60000);
  });

  await Promise.race([allTestsPromise, testTimeout]);

  const testTime = Date.now() - buildTime;

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

        // Notify container of test file changes
        if (containerRpc?.onTestFileUpdate) {
          await containerRpc.onTestFileUpdate(currentTestFiles);
        }

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

      // No file list changes, iframes will automatically rerun tests
      isRerunning = false;
      logger.log(color.cyan('Tests will be re-executed automatically\n'));
    };
  }

  if (!isWatchMode) {
    await destroyBrowserRuntime(runtime!);
  }

  if (fatalError) {
    logger.error(
      color.red(`Browser test run failed: ${(fatalError as Error).message}`),
    );
    ensureProcessExitCode(1);
    return;
  }

  const duration = {
    totalTime: buildTime + testTime,
    buildTime,
    testTime,
  };

  context.updateReporterResultState(reporterResults, caseResults);

  const isFailure = reporterResults.some(
    (result: TestFileResult) => result.status === 'fail',
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

  // Enable watch hooks AFTER initial test run to avoid duplicate runs
  if (isWatchMode && triggerRerun) {
    enableWatchHooks = true;
    logger.log(
      color.cyan('\nWatch mode enabled - will re-run tests on file changes\n'),
    );
  }
};
