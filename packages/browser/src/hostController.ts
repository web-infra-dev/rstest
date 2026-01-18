import fs from 'node:fs/promises';
import {
  color,
  isDebug,
  logger,
  type Reporter,
  type Rstest,
  TEMP_RSTEST_OUTPUT_DIR,
  type TestFileResult,
  type TestResult,
  type UserConsoleLog,
} from '@rstest/core/browser';
import { basename, dirname, join, normalize } from 'pathe';
import type { BrowserContext, ConsoleMessage, Page } from 'playwright';

import {
  collectProjectEntries,
  generateManifestModule,
} from './manifest/index';

export {
  type ListBrowserTestsResult,
  listBrowserTests,
} from './listBrowserTests';

import {
  getBrowserProjects,
  getRuntimeConfigFromProject,
} from './manifest/projectConfig';
import type {
  BrowserHostConfig,
  BrowserProjectRuntime,
  TestFileInfo,
} from './protocol';
import { ContainerRpcManager } from './rpc/containerRpcManager';
import { createReadyGate } from './rpc/readyGate';
import type {
  FatalPayload,
  HostRpcMethods,
  LogPayload,
  TestFileStartPayload,
} from './rpc/types';
import {
  createBrowserRuntime,
  destroyBrowserRuntime,
  registerWatchCleanup,
  resolveContainerDist,
} from './runtime/browserRuntime';
import { TestFileScheduler } from './scheduler/testFileScheduler';
import { watchContext } from './watch/context';

const ensureProcessExitCode = (code: number): void => {
  if (process.exitCode === undefined || process.exitCode === 0) {
    process.exitCode = code;
  }
};

export const runBrowserController = async (context: Rstest): Promise<void> => {
  const buildStart = Date.now();
  const containerDevServerEnv = process.env.RSTEST_CONTAINER_DEV_SERVER;
  let containerDevServer: string | undefined;
  let containerDistPath: string | undefined;

  if (containerDevServerEnv) {
    try {
      containerDevServer = new URL(containerDevServerEnv).toString();
      logger.debug(
        `[Browser UI] Using dev server for container: ${containerDevServer}`,
      );
    } catch (error) {
      logger.error(
        color.red(
          `Invalid RSTEST_CONTAINER_DEV_SERVER value: ${String(error)}`,
        ),
      );
      ensureProcessExitCode(1);
      return;
    }
  }

  if (!containerDevServer) {
    try {
      containerDistPath = resolveContainerDist();
    } catch (error) {
      logger.error(color.red(String(error)));
      ensureProcessExitCode(1);
      return;
    }
  }

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
    isWatchMode && watchContext.runtime
      ? watchContext.runtime.tempDir
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

  if (isWatchMode) {
    watchContext.lastTestFiles = projectEntries.flatMap((entry) =>
      entry.testFiles.map((testPath) => ({
        testPath,
        projectName: entry.project.name,
      })),
    );
  }

  let runtime = isWatchMode ? watchContext.runtime : null;
  let triggerRerun: (() => Promise<void>) | undefined;

  if (!runtime) {
    try {
      runtime = await createBrowserRuntime({
        context,
        manifestPath,
        manifestSource,
        tempDir,
        isWatchMode,
        onTriggerRerun: isWatchMode
          ? async () => {
              await triggerRerun?.();
            }
          : undefined,
        containerDistPath,
        containerDevServer,
      });
    } catch (error) {
      logger.error(error instanceof Error ? error : new Error(String(error)));
      ensureProcessExitCode(1);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return;
    }

    if (isWatchMode) {
      watchContext.runtime = runtime;
      registerWatchCleanup(watchContext);
    }
  }

  const { browser, port, wsPort, wss } = runtime;
  const buildTime = Date.now() - buildStart;

  const allTestFiles: TestFileInfo[] = projectEntries.flatMap((entry) =>
    entry.testFiles.map((testPath) => ({
      testPath: normalize(testPath),
      projectName: entry.project.name,
    })),
  );

  const browserProjectsForRuntime = getBrowserProjects(context);
  const projectRuntimeConfigs: BrowserProjectRuntime[] =
    browserProjectsForRuntime.map((project) => ({
      name: project.name,
      environmentName: project.environmentName,
      projectRoot: normalize(project.rootPath),
      runtimeConfig: getRuntimeConfigFromProject(project),
    }));

  const maxTestTimeoutForRpc = Math.max(
    ...browserProjectsForRuntime.map(
      (p) => p.normalizedConfig.testTimeout ?? 5000,
    ),
  );

  const hostOptions: BrowserHostConfig = {
    rootPath: normalize(context.rootPath),
    projects: projectRuntimeConfigs,
    snapshot: {
      updateSnapshot: context.snapshotManager.options.updateSnapshot,
    },
    runnerUrl: `http://localhost:${port}`,
    wsPort,
    debug: isDebug(),
    rpcTimeout: maxTestTimeoutForRpc,
  };

  runtime.setContainerOptions(hostOptions);

  const reporterResults: TestFileResult[] = [];
  const caseResults: TestResult[] = [];
  let completedTests = 0;
  let fatalError: Error | null = null;

  let resolveAllTests: (() => void) | undefined;
  const allTestsPromise = new Promise<void>((resolve) => {
    resolveAllTests = resolve;
  });

  const readyGate = createReadyGate();
  let scheduler: TestFileScheduler | null = null;

  let containerContext: BrowserContext;
  let containerPage: Page;
  let isNewPage = false;

  if (isWatchMode && runtime.containerPage && runtime.containerContext) {
    containerContext = runtime.containerContext;
    containerPage = runtime.containerPage;
    logger.log(color.gray('\n[Watch] Reusing existing container page\n'));
  } else {
    isNewPage = true;
    containerContext = await browser.newContext({
      viewport: null,
    });
    containerPage = await containerContext.newPage();

    containerPage.on('popup', async (popup: Page) => {
      await popup.close().catch(() => {});
    });

    containerContext.on('page', async (page: Page) => {
      if (page !== containerPage) {
        await page.close().catch(() => {});
      }
    });

    if (isWatchMode) {
      runtime.containerPage = containerPage;
      runtime.containerContext = containerContext;
    }

    containerPage.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      if (text.includes('[Container]') || text.includes('[Runner]')) {
        logger.log(color.gray(`[Browser Console] ${text}`));
      }
    });
  }

  const createRpcMethods = (): HostRpcMethods => ({
    async rerunTest(testFile: string, testNamePattern?: string) {
      logger.log(
        color.cyan(
          `\nRe-running test: ${testFile}${testNamePattern ? ` (pattern: ${testNamePattern})` : ''}\n`,
        ),
      );
      await rpcManager.reloadTestFile(testFile, testNamePattern);
    },
    async getTestFiles() {
      return allTestFiles;
    },
    async onContainerReady() {
      if (!readyGate.isReady()) {
        readyGate.markReady();
        logger.debug('[Scheduler] Container reported ready');
      }
    },
    async onTestFileStart(payload: TestFileStartPayload) {
      await Promise.all(
        context.reporters.map((reporter) =>
          (reporter as Reporter).onTestFileStart?.({
            testPath: payload.testPath,
            tests: [],
          }),
        ),
      );
    },
    async onTestCaseResult(payload: TestResult) {
      caseResults.push(payload);
      await Promise.all(
        context.reporters.map((reporter) =>
          (reporter as Reporter).onTestCaseResult?.(payload),
        ),
      );
    },
    async onTestFileComplete(payload: TestFileResult) {
      reporterResults.push(payload);
      if (payload.snapshotResult) {
        context.snapshotManager.add(payload.snapshotResult);
      }
      await Promise.all(
        context.reporters.map((reporter) =>
          (reporter as Reporter).onTestFileResult?.(payload),
        ),
      );

      completedTests++;

      if (scheduler !== null) {
        scheduler.onTestFileComplete(payload.testPath);
      } else if (completedTests >= allTestFiles.length && resolveAllTests) {
        resolveAllTests();
      }
    },
    async onLog(payload: LogPayload) {
      const log: UserConsoleLog = {
        content: payload.content,
        name: payload.level,
        testPath: payload.testPath,
        type: payload.type,
        trace: payload.trace,
      };

      const shouldLog =
        context.normalizedConfig.onConsoleLog?.(log.content) ?? true;

      if (shouldLog) {
        await Promise.all(
          context.reporters.map((reporter) =>
            (reporter as Reporter).onUserConsoleLog?.(log),
          ),
        );
      }
    },
    async onFatal(payload: FatalPayload) {
      fatalError = new Error(payload.message);
      fatalError.stack = payload.stack;
      if (scheduler !== null) {
        scheduler.onFatal();
      }
      if (resolveAllTests) {
        resolveAllTests();
      }
    },
    async resolveSnapshotPath(testPath: string) {
      const snapExtension = '.snap';
      const resolver =
        context.normalizedConfig.resolveSnapshotPath ||
        (() =>
          join(
            dirname(testPath),
            '__snapshots__',
            `${basename(testPath)}${snapExtension}`,
          ));
      return resolver(testPath, snapExtension);
    },
    async readSnapshotFile(filepath: string) {
      try {
        return await fs.readFile(filepath, 'utf-8');
      } catch {
        return null;
      }
    },
    async saveSnapshotFile(filepath: string, content: string) {
      const dir = dirname(filepath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filepath, content, 'utf-8');
    },
    async removeSnapshotFile(filepath: string) {
      try {
        await fs.unlink(filepath);
      } catch {
        // ignore if file doesn't exist
      }
    },
  });

  let rpcManager: ContainerRpcManager;

  if (isWatchMode && runtime.rpcManager) {
    rpcManager = runtime.rpcManager;
    rpcManager.updateMethods(createRpcMethods());
    const existingWs = rpcManager.currentWebSocket;
    if (existingWs) {
      rpcManager.reattach(existingWs);
    }
  } else {
    rpcManager = new ContainerRpcManager(wss, createRpcMethods());

    if (isWatchMode) {
      runtime.rpcManager = rpcManager;
    }
  }

  scheduler = new TestFileScheduler(
    Number.MAX_SAFE_INTEGER,
    rpcManager,
    resolveAllTests,
  );

  readyGate.reset();

  if (isNewPage) {
    await containerPage.goto(`http://localhost:${port}/`, {
      waitUntil: 'load',
    });

    logger.log(
      color.cyan(`\nBrowser mode opened at http://localhost:${port}/\n`),
    );
  }

  const maxTestTimeout = Math.max(
    ...browserProjectsForRuntime.map(
      (p) => p.normalizedConfig.testTimeout ?? 5000,
    ),
  );
  const totalTimeoutMs = maxTestTimeout * allTestFiles.length + 30_000;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const testTimeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.log(
        color.yellow(
          `\nTest execution timeout after ${totalTimeoutMs / 1000}s. ` +
            `Completed: ${completedTests}/${allTestFiles.length}\n`,
        ),
      );
      resolve();
    }, totalTimeoutMs);
  });

  await readyGate.wait();
  logger.debug('[Scheduler] Container ready, starting test execution');
  scheduler.start(allTestFiles);

  const testStart = Date.now();
  await Promise.race([allTestsPromise, testTimeout]);

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  const testTime = Date.now() - testStart;

  if (isWatchMode) {
    triggerRerun = async () => {
      const newProjectEntries = await collectProjectEntries(context);
      const currentTestFiles: TestFileInfo[] = newProjectEntries.flatMap(
        (entry) =>
          entry.testFiles.map((testPath) => ({
            testPath,
            projectName: entry.project.name,
          })),
      );

      const serialize = (files: TestFileInfo[]) =>
        JSON.stringify(
          files.map((f) => `${f.projectName}:${f.testPath}`).sort(),
        );

      const filesChanged =
        serialize(currentTestFiles) !== serialize(watchContext.lastTestFiles);

      const previousTestPaths = new Set(
        watchContext.lastTestFiles.map((f) => f.testPath),
      );
      const newTestFiles = currentTestFiles.filter(
        (f) => !previousTestPaths.has(f.testPath),
      );

      if (filesChanged) {
        watchContext.lastTestFiles = currentTestFiles;
        readyGate.reset();
        await rpcManager.notifyTestFileUpdate(currentTestFiles);
        await readyGate.wait();
      }

      const affectedFilePaths = watchContext.affectedTestFiles;
      watchContext.affectedTestFiles = [];

      const allFilesToRun = new Set(affectedFilePaths);
      for (const newFile of newTestFiles) {
        allFilesToRun.add(newFile.testPath);
      }

      if (allFilesToRun.size > 0) {
        logger.log(
          color.cyan(
            `Re-running ${allFilesToRun.size} affected test file(s)...\n`,
          ),
        );

        const testFilesLookup = filesChanged
          ? currentTestFiles
          : watchContext.lastTestFiles;
        const affectedTestFiles = [...allFilesToRun]
          .map((testPath) =>
            testFilesLookup.find((f) => f.testPath === testPath),
          )
          .filter((f): f is TestFileInfo => f !== undefined);

        if (affectedTestFiles.length > 0) {
          scheduler.scheduleFiles(affectedTestFiles);
        }
      } else if (!filesChanged) {
        logger.log(color.cyan('Tests will be re-executed automatically\n'));
      }
    };
  }

  if (!isWatchMode) {
    await destroyBrowserRuntime(runtime);
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

  if (isWatchMode && triggerRerun) {
    watchContext.hooksEnabled = true;
    logger.log(
      color.cyan('\nWatch mode enabled - will re-run tests on file changes\n'),
    );
  }
};
