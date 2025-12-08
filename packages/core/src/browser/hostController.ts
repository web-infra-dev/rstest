import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
// import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { RsbuildDevServer, RsbuildInstance } from '@rsbuild/core';
import { createRsbuild, rspack } from '@rsbuild/core';
import type { BirpcReturn } from 'birpc';
import { dirname, join, relative, resolve, sep } from 'pathe';
import openEditor from 'open-editor';
import type {
  BrowserContext,
  ConsoleMessage,
  Frame,
  Page,
} from 'playwright-core';
import sirv from 'sirv';
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

// const resolvePackageRoot = (pkgName: string): string => {
//   const require = createRequire(import.meta.url);
//   const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
//   return dirname(pkgJsonPath);
// };

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
    bail,
    logHeapUsage,
    chaiConfig,
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
    bail,
    logHeapUsage,
    chaiConfig,
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

const resolveContainerDist = (): string => {
  const distPath = resolve(__dirname, '../dist/browser-container');
  if (existsSync(distPath)) {
    return distPath;
  }

  throw new Error(
    `Browser container build not found at ${distPath}. Please run "pnpm --filter @rstest/core build".`,
  );
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
  containerPage?: Page;
  containerContext?: BrowserContext;
  containerDistPath?: string;
  containerDevServer?: string;
  setContainerOptions: (options: BrowserHostConfig) => void;
};

type HostRpcMethods = {
  rerunTest: (testFile: string) => Promise<void>;
  getTestFiles: () => Promise<string[]>;
};

type ContainerRpcClient = {
  onTestFileUpdate: (testFiles: string[]) => Promise<void>;
};

type ContainerRpc = BirpcReturn<ContainerRpcClient, HostRpcMethods>;

type ContainerWindow = {
  __rstest_container_on__?: (payload: unknown) => void;
  __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
};

type BindingSource = {
  context: BrowserContext;
  page: Page;
  frame: Frame;
};

let sharedRuntime: BrowserRuntime | null = null;
let watchCleanupRegistered = false;
let lastTestFiles: string[] = [];
let enableWatchHooks = false; // Flag to control if watch hooks should execute
let pendingManifestUpdate = 0; // Counter to track manifest updates that will trigger recompilation

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
  containerDistPath,
  containerDevServer,
}: {
  context: Rstest;
  manifestPath: string;
  manifestSource: string;
  tempDir: string;
  isWatchMode: boolean;
  onTriggerRerun?: () => Promise<void>;
  containerDistPath?: string;
  containerDevServer?: string;
}): Promise<BrowserRuntime> => {
  const virtualManifestPlugin = new rspack.experiments.VirtualModulesPlugin({
    [manifestPath]: manifestSource,
  });

  const optionsPlaceholder = '__RSTEST_OPTIONS_PLACEHOLDER__';
  const containerHtmlTemplate = containerDistPath
    ? await fs.readFile(join(containerDistPath, 'container.html'), 'utf-8')
    : null;

  let injectedContainerHtml: string | null = null;
  let serializedOptions = 'null';

  const setContainerOptions = (options: BrowserHostConfig): void => {
    serializedOptions = JSON.stringify(options).replace(/</g, '\\u003c');
    if (containerHtmlTemplate) {
      injectedContainerHtml = containerHtmlTemplate.replace(
        optionsPlaceholder,
        serializedOptions,
      );
    }
  };

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

            // Skip if this compile was triggered by our manifest update
            if (pendingManifestUpdate > 0) {
              pendingManifestUpdate--;
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

  // Serve prebuilt container assets (SPA) via sirv, scoped to avoid clashing with runner assets
  const serveContainer = containerDistPath
    ? sirv(containerDistPath, {
        dev: false,
        single: 'container.html',
      })
    : null;

  const containerDevBase = containerDevServer
    ? new URL(containerDevServer)
    : null;

  const respondWithDevServerHtml = async (
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> => {
    if (!containerDevBase) {
      return false;
    }

    try {
      const target = new URL(url.pathname + url.search, containerDevBase);
      const response = await fetch(target);
      if (!response.ok) {
        return false;
      }

      let html = await response.text();
      html = html.replace(optionsPlaceholder, serializedOptions);

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'content-length') {
          return;
        }
        res.setHeader(key, value);
      });
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
      return true;
    } catch (error) {
      logger.log(
        color.yellow(
          `[Browser UI] Failed to fetch container HTML from dev server: ${String(error)}`,
        ),
      );
      return false;
    }
  };

  const proxyDevServerAsset = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    if (!containerDevBase || !req.url) {
      return false;
    }

    try {
      const target = new URL(req.url, containerDevBase);
      const response = await fetch(target);
      if (!response.ok) {
        return false;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'content-length') {
          return;
        }
        res.setHeader(key, value);
      });
      res.end(buffer);
      return true;
    } catch (error) {
      logger.log(
        color.yellow(
          `[Browser UI] Failed to proxy asset from dev server: ${String(error)}`,
        ),
      );
      return false;
    }
  };

  devServer.middlewares.use(async (req, res, next) => {
    if (!req.url) {
      next();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__open-in-editor') {
      const file = url.searchParams.get('file');
      if (!file) {
        res.statusCode = 400;
        res.end('Missing file');
        return;
      }
      try {
        await openEditor([{ file }]);
        res.statusCode = 204;
        res.end();
      } catch (error) {
        logger.log(
          color.yellow(`[Browser UI] Failed to open editor: ${String(error)}`),
        );
        res.statusCode = 500;
        res.end('Failed to open editor');
      }
      return;
    }
    if (url.pathname === '/' || url.pathname === '/container.html') {
      if (await respondWithDevServerHtml(url, res)) {
        return;
      }

      const html =
        injectedContainerHtml ||
        containerHtmlTemplate?.replace(optionsPlaceholder, 'null');

      if (html) {
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
        return;
      }

      res.statusCode = 502;
      res.end('Container UI is not available.');
      return;
    }
    if (url.pathname.startsWith('/container-static/')) {
      if (await proxyDevServerAsset(req, res)) {
        return;
      }

      if (serveContainer) {
        serveContainer(req, res, next);
        return;
      }

      res.statusCode = 502;
      res.end('Container assets are not available.');
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
    containerDistPath,
    containerDevServer,
    setContainerOptions,
  };
};

export const runBrowserController = async (context: Rstest): Promise<void> => {
  const buildStart = Date.now();
  const containerDevServerEnv = process.env.RSTEST_CONTAINER_DEV_SERVER;
  let containerDevServer: string | undefined;
  let containerDistPath: string | undefined;

  if (containerDevServerEnv) {
    try {
      containerDevServer = new URL(containerDevServerEnv).toString();
      logger.log(
        color.gray(
          `[Browser UI] Using dev server for container: ${containerDevServer}`,
        ),
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
        containerDistPath,
        containerDevServer,
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

  const projectRuntimeConfigs: BrowserProjectRuntime[] = context.projects.map(
    (project: ProjectContext) => ({
      name: project.name,
      environmentName: project.environmentName,
      projectRoot: project.rootPath,
      runtimeConfig: serializableConfig(getRuntimeConfigFromProject(project)),
    }),
  );

  let hostOptions: BrowserHostConfig = {
    rootPath: context.rootPath,
    projects: projectRuntimeConfigs,
    snapshot: {
      updateSnapshot: context.snapshotManager.options.updateSnapshot,
    },
    runnerUrl: `http://localhost:${port}`,
    testFiles: allTestFiles,
  };

  runtime!.setContainerOptions(hostOptions);

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
  let containerContext: BrowserContext;
  let containerPage: Page;
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
    containerPage.on('popup', async (popup: Page) => {
      await popup.close().catch(() => {});
    });

    // Also prevent popups from the context level
    containerContext.on('page', async (page: Page) => {
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
      async (_source: BindingSource, payload: BrowserClientMessage) => {
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
      async (_source: BindingSource, data: unknown) => {
        postToContainer?.(data);
      },
    );

    // Forward browser console to terminal
    containerPage.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      if (text.includes('[Container]') || text.includes('[Runner]')) {
        logger.log(color.gray(`[Browser Console] ${text}`));
      }
    });
  }

  // Birpc setup (need to recreate on each run to capture current context)
  let containerRpc: ContainerRpc | null = null;
  let postToContainer: ((data: unknown) => void) | null = null;

  const containerMethods: HostRpcMethods = {
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

  containerRpc = createBirpc<ContainerRpcClient, HostRpcMethods>(
    containerMethods,
    {
      post: (data) => {
        containerPage
          ?.evaluate((msg: unknown) => {
            (window as unknown as ContainerWindow).__rstest_container_on__?.(
              msg,
            );
          }, data)
          .catch(() => {});
      },
      on: (fn: (data: unknown) => void) => {
        postToContainer = fn;
      },
    },
  );

  // Only navigate and setup on first creation (new page)
  if (isNewPage) {
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
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const testTimeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.log(
        color.yellow(
          `\nTest execution timeout after 60s. Completed: ${completedTests}/${allTestFiles.length}\n`,
        ),
      );
      resolve();
    }, 60000);
  });

  const testStart = Date.now();
  await Promise.race([allTestsPromise, testTimeout]);

  // Clear timeout to allow process to exit
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  const testTime = Date.now() - testStart;

  // Define rerun logic for watch mode
  if (isWatchMode) {
    triggerRerun = async () => {
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

        hostOptions = {
          ...hostOptions,
          testFiles: currentTestFiles,
        };

        runtime!.setContainerOptions(hostOptions);

        // Notify container of test file changes
        if (containerRpc?.onTestFileUpdate) {
          await containerRpc.onTestFileUpdate(currentTestFiles);
        }

        // Regenerate manifest only if files changed
        const newManifestSource = generateManifestModule({
          manifestPath,
          entries: newProjectEntries,
        });

        // Increment counter before updating manifest - the update will trigger
        // a recompilation, and we need to skip that compile event
        pendingManifestUpdate++;
        runtime!.manifestPlugin.writeModule(manifestPath, newManifestSource);

        // The manifest update will trigger onAfterDevCompile, which will be
        // skipped due to pendingManifestUpdate counter. Tests in iframes will
        // automatically reload with the new manifest.
        return;
      }

      // No file list changes, iframes will automatically rerun tests
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
