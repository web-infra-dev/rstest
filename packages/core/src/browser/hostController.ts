import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RsbuildDevServer, RsbuildInstance } from '@rsbuild/core';
import { createRsbuild } from '@rsbuild/core';
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

const writeManifestFile = async ({
  manifestPath,
  entries,
}: {
  manifestPath: string;
  entries: BrowserProjectEntries[];
}): Promise<void> => {
  await fs.mkdir(dirname(manifestPath), { recursive: true });

  const records: BrowserManifestEntry[] = [];
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
  lines.push(`export const manifest = [`);

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
      records.push(record);

      lines.push(
        `  {`,
        `    id: ${JSON.stringify(record.id)},`,
        `    type: 'setup',`,
        `    projectName: ${JSON.stringify(record.projectName)},`,
        `    projectRoot: ${JSON.stringify(toPosix(record.projectRoot))},`,
        `    filePath: ${JSON.stringify(toPosix(record.filePath))},`,
        `    relativePath: ${JSON.stringify(record.relativePath)},`,
        `    load: () => import(${JSON.stringify(record.relativePath)}),`,
        `  },`,
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
      records.push(record);
      lines.push(
        `  {`,
        `    id: ${JSON.stringify(record.id)},`,
        `    type: 'test',`,
        `    projectName: ${JSON.stringify(record.projectName)},`,
        `    projectRoot: ${JSON.stringify(toPosix(record.projectRoot))},`,
        `    filePath: ${JSON.stringify(toPosix(record.filePath))},`,
        `    testPath: ${JSON.stringify(toPosix(record.testPath!))},`,
        `    relativePath: ${JSON.stringify(record.relativePath)},`,
        `    load: () => import(${JSON.stringify(record.relativePath)}),`,
        `  },`,
      );
    });
  }

  lines.push(`] as const;`);

  await fs.writeFile(manifestPath, lines.join('\n'), 'utf-8');
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
  browser: any;
  page: any;
  port: number;
  manifestPath: string;
  tempDir: string;
};

let sharedRuntime: BrowserRuntime | null = null;
let watchCleanupRegistered = false;
let currentRunHandler:
  | ((payload: BrowserClientMessage) => Promise<void>)
  | null = null;

const destroyBrowserRuntime = async (runtime: BrowserRuntime): Promise<void> => {
  try {
    await runtime.page?.close?.();
  } catch {
    // ignore
  }
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
  await fs.rm(runtime.tempDir, { recursive: true, force: true }).catch(() => {});
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
  tempDir,
}: {
  context: Rstest;
  manifestPath: string;
  tempDir: string;
}): Promise<BrowserRuntime> => {
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
            },
          },
        },
      },
    },
  });

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

  let chromiumLauncher;
  try {
    ({ chromium: chromiumLauncher } = await import('playwright-core'));
  } catch (error) {
    await devServer.close();
    throw error;
  }

  let browser;
  try {
    browser = await chromiumLauncher.launch({
      headless: context.normalizedConfig.browser.headless,
    });
  } catch (error) {
    await devServer.close();
    throw error;
  }

  const page = await browser.newPage();

  await page.exposeBinding(
    '__rstest_dispatch__',
    async (_source: unknown, payload: BrowserClientMessage) => {
      await currentRunHandler?.(payload);
    },
  );

  return {
    rsbuildInstance,
    devServer,
    browser,
    page,
    port,
    manifestPath,
    tempDir,
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

  await writeManifestFile({
    manifestPath,
    entries: projectEntries,
  });

  let runtime = isWatchMode ? sharedRuntime : null;
  if (!runtime || !isWatchMode) {
    try {
      runtime = await createBrowserRuntime({
        context,
        manifestPath,
        tempDir,
      });
    } catch (error) {
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

  const { page, port } = runtime!;
  const buildTime = Date.now() - buildStart;

  const reporterResults: TestFileResult[] = [];
  const caseResults: TestResult[] = [];
  let fatalError: Error | null = null;

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

  currentRunHandler = async (payload: BrowserClientMessage) => {
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
  };

  const runStart = Date.now();
  try {
    await page.goto(`http://localhost:${port}/runner.html`, {
      waitUntil: 'load',
    });
    await runPromise;
  } catch (error) {
    if (!fatalError) {
      fatalError = error instanceof Error ? error : new Error(String(error));
      completeRun();
    }
  } finally {
    currentRunHandler = null;
    if (!isWatchMode) {
      await destroyBrowserRuntime(runtime!);
    }
  }

  if (fatalError) {
    logger.error(color.red(`Browser test run failed: ${fatalError.message}`));
    ensureProcessExitCode(1);
    return;
  }

  const testTime = Date.now() - runStart;
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
};
