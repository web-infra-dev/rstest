import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import {
  afterAll as rstestAfterAll,
  afterEach as rstestAfterEach,
  beforeAll as rstestBeforeAll,
  beforeEach as rstestBeforeEach,
  describe as rstestDescribe,
  rstest,
  expect as rstestExpect,
  test as base,
} from '@rstest/core';
import type {
  Fixtures,
  TestAPIs,
  TestForFn,
  TestOptions,
  Use,
} from '@rstest/core';
import type { TestContext } from '@rstest/core';
import { chromium, request as playwrightRequest } from 'playwright';
import { withPlaywrightExpect } from './expect';
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  BrowserType,
  LaunchOptions,
  Page,
} from 'playwright';

export type PlaywrightBrowserName = 'chromium';

export type PlaywrightRequestOptions = Parameters<
  typeof playwrightRequest.newContext
>[0];

export type PlaywrightDebugOptions = {
  /**
   * Run the browser in headed mode and slow down Playwright operations.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Time to slow down Playwright operations in milliseconds.
   *
   * @default 100
   */
  slowMo?: number;
  /**
   * Open Chromium DevTools for each tab.
   *
   * @default true
   */
  devtools?: boolean;
  /**
   * Pause the page automatically when the test fails in debug mode.
   *
   * @default true
   */
  pauseOnFailure?: boolean;
};

export type PlaywrightTraceMode = 'off' | 'on' | 'retain-on-failure';

export type PlaywrightTraceOptions = {
  /**
   * When to save a Playwright trace.
   *
   * @default 'off'
   */
  mode?: PlaywrightTraceMode;
  /**
   * Directory where trace artifacts are written.
   *
   * @default '<projectRoot>/.rstest/playwright-traces'
   */
  outputDir?: string;
  /**
   * Capture screenshots in the Playwright trace.
   *
   * @default true
   */
  screenshots?: boolean;
  /**
   * Capture DOM snapshots in the Playwright trace.
   *
   * @default true
   */
  snapshots?: boolean;
  /**
   * Capture test source files in the Playwright trace.
   *
   * @default true
   */
  sources?: boolean;
  /**
   * Print the `playwright show-trace` command after saving a trace.
   *
   * @default true
   */
  print?: boolean;
  /**
   * Generate AI-readable `trace-summary.json` and `debug.md` files next to
   * `trace.zip`.
   *
   * @default true
   */
  summary?: boolean;
};

export type PlaywrightServeOptions = {
  /** Host used by the static server. */
  host?: string;
  /** Port used by the static server. Uses a random free port by default. */
  port?: number;
  /** Extra response headers for static files. */
  headers?: Record<string, string>;
  /**
   * Keep the server alive in debug mode so the page remains available for inspection.
   *
   * @default true
   */
  keepAliveOnDebug?: boolean;
};

export type PlaywrightServe = (
  entry: string,
  options?: PlaywrightServeOptions,
) => Promise<PlaywrightServeResult>;

export type PlaywrightServeResult = {
  /** Server URL used by `page.goto()`. */
  url: string;
  /** Stop the server after the test, unless debug keep-alive is enabled. */
  close: () => Promise<void> | void;
};

export type PlaywrightOptions = {
  /**
   * Browser engine to launch.
   *
   * @default 'chromium'
   */
  browserName?: PlaywrightBrowserName;
  /** Options passed to `browserType.launch()`. */
  launchOptions?: LaunchOptions;
  /** Options passed to `browser.newContext()`. */
  contextOptions?: BrowserContextOptions;
  /** Options passed to `request.newContext()`. */
  requestOptions?: PlaywrightRequestOptions;
  /** Convenience options for local headed debugging. */
  debug?: boolean | PlaywrightDebugOptions;
  /** Capture Playwright trace artifacts for browser debugging. */
  trace?: PlaywrightTraceMode | PlaywrightTraceOptions;
};

export type PlaywrightFixture = {
  /** Playwright fixture options used by the current test. */
  playwright: PlaywrightOptions;
  /** Shared Playwright browser for the worker. */
  browser: Browser;
  /** Isolated browser context created for each test that uses it. */
  context: BrowserContext;
  /** Isolated page created for each test that uses it. */
  page: Page;
  /** Isolated API request context created for each test that uses it. */
  request: APIRequestContext;
  /** Start a static server from inside the test and clean it up automatically. */
  serve: PlaywrightServe;
};

export type PlaywrightUse<T> = Use<T>;

const DEFAULT_BROWSER_NAME = 'chromium' satisfies PlaywrightBrowserName;

const DEBUG_ENV = 'PWDEBUG';
const PAUSE_ENV = 'RSTEST_PLAYWRIGHT_PAUSE';
const TRACE_ENV = 'RSTEST_PLAYWRIGHT_TRACE';
const TRACE_OUTPUT_DIR_ENV = 'RSTEST_PLAYWRIGHT_TRACE_OUTPUT_DIR';
const DEBUG_PAUSE_TIMEOUT = 24 * 60 * 60 * 1000;
const BROWSER_IDLE_CLOSE_DELAY = 1000;
const DEFAULT_STATIC_SERVER_HOST = '127.0.0.1';
const DEFAULT_TRACE_OUTPUT_DIR = join('.rstest', 'playwright-traces');
const TEST_EACH_CONTEXT_SYMBOL = Symbol.for('rstest.test.each.context');
const TEST_EACH_CONTEXT_PARAM = '__rstestPlaywrightContext';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

const browserCache = new Map<string, Promise<Browser>>();
let activeBrowserFixtureCount = 0;
let browserCleanupPromise: Promise<void> | undefined;
let browserCleanupTimer: ReturnType<typeof setTimeout> | undefined;

const browserTypes = {
  chromium,
} satisfies Record<PlaywrightBrowserName, BrowserType>;

export const getDebugOptions = (
  debug: PlaywrightOptions['debug'],
): PlaywrightDebugOptions | undefined => {
  const normalizedDebug = debug ?? Boolean(process.env[DEBUG_ENV]);

  if (
    !normalizedDebug ||
    (typeof normalizedDebug !== 'boolean' && normalizedDebug.enabled === false)
  ) {
    return;
  }

  return typeof normalizedDebug === 'boolean' ? {} : normalizedDebug;
};

const isDebugEnabled = (debug: PlaywrightOptions['debug']) =>
  getDebugOptions(debug) !== undefined;

const shouldPauseOnFailure = (playwright: PlaywrightOptions) => {
  const debugOptions = getDebugOptions(playwright.debug);

  if (!debugOptions) {
    return false;
  }

  if (process.env[PAUSE_ENV] === 'false') {
    return false;
  }

  return debugOptions.pauseOnFailure ?? true;
};

const normalizeTraceOptions = (
  trace: PlaywrightOptions['trace'],
): Required<Omit<PlaywrightTraceOptions, 'outputDir'>> & {
  outputDir?: string;
} => {
  const traceOptions: PlaywrightTraceOptions | undefined =
    trace === undefined
      ? getEnvTraceOptions()
      : typeof trace === 'string'
        ? { mode: trace }
        : trace;

  return {
    mode: traceOptions?.mode ?? 'off',
    outputDir: traceOptions?.outputDir,
    screenshots: traceOptions?.screenshots ?? true,
    snapshots: traceOptions?.snapshots ?? true,
    sources: traceOptions?.sources ?? true,
    print: traceOptions?.print ?? true,
    summary: traceOptions?.summary ?? true,
  };
};

const normalizeTraceMode = (
  mode: string | undefined,
): PlaywrightTraceMode | undefined => {
  return mode === 'on' || mode === 'off' || mode === 'retain-on-failure'
    ? mode
    : undefined;
};

const getEnvTraceOptions = (): PlaywrightTraceOptions | undefined => {
  const mode = normalizeTraceMode(process.env[TRACE_ENV]);

  if (!mode) {
    return;
  }

  return {
    mode,
    outputDir: process.env[TRACE_OUTPUT_DIR_ENV],
  };
};

const getTraceArtifacts = (
  playwright: PlaywrightOptions,
  task: TestContext['task'],
) => {
  const options = normalizeTraceOptions(playwright.trace);

  if (options.mode === 'off') {
    return;
  }

  const projectRoot = task.projectRoot ?? process.cwd();
  const outputRoot = options.outputDir
    ? isAbsolute(options.outputDir)
      ? options.outputDir
      : resolve(projectRoot, options.outputDir)
    : resolve(projectRoot, DEFAULT_TRACE_OUTPUT_DIR);
  const dir = join(outputRoot, getTraceArtifactName(task));

  return {
    options,
    dir,
    tracePath: join(dir, 'trace.zip'),
    summaryPath: join(dir, 'trace-summary.json'),
    debugPath: join(dir, 'debug.md'),
  };
};

type TraceArtifacts = NonNullable<ReturnType<typeof getTraceArtifacts>>;

const getTraceArtifactName = (task: TestContext['task']) => {
  const source = [task.filepath, task.id, task.name].filter(Boolean).join(' ');
  let hash = 0;

  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }

  const sanitizedName = task.name
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80);

  return `${sanitizedName || 'test'}-${hash.toString(16).padStart(8, '0')}`;
};

const getFormattedErrors = (task: TestContext['task']) => {
  return (task.result?.errors ?? []).map((error) => ({
    name: error.name,
    message: error.message,
    stack: error.stack,
  }));
};

const formatRelativePath = (projectRoot: string, path: string) => {
  const relativePath = relative(projectRoot, path);

  if (
    relativePath.startsWith('..') ||
    relativePath.startsWith(sep) ||
    isAbsolute(relativePath)
  ) {
    return path;
  }

  return relativePath || '.';
};

const quoteShellArg = (value: string) => {
  if (process.platform === 'win32') {
    return `"${value}"`;
  }

  return `'${value.replaceAll("'", `'\\''`)}'`;
};

const getShowTraceCommand = (
  artifacts: TraceArtifacts,
  projectRoot: string,
) => {
  const tracePath = quoteShellArg(
    formatRelativePath(projectRoot, artifacts.tracePath),
  );

  return `npx playwright show-trace ${tracePath}`;
};

const reserveTraceArtifacts = async (
  artifacts: TraceArtifacts,
): Promise<TraceArtifacts> => {
  await mkdir(dirname(artifacts.dir), { recursive: true });

  for (let index = 0; ; index++) {
    const dir = index === 0 ? artifacts.dir : `${artifacts.dir}-${index}`;

    try {
      await mkdir(dir);

      return {
        ...artifacts,
        dir,
        tracePath: join(dir, 'trace.zip'),
        summaryPath: join(dir, 'trace-summary.json'),
        debugPath: join(dir, 'debug.md'),
      };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error;
      }
    }
  }
};

const writeTraceSummary = async ({
  artifacts,
  task,
}: {
  artifacts: TraceArtifacts;
  task: TestContext['task'];
}) => {
  const projectRoot = task.projectRoot ?? process.cwd();
  const showTraceCommand = getShowTraceCommand(artifacts, projectRoot);
  const errors = getFormattedErrors(task);
  const summary = {
    test: {
      id: task.id,
      name: task.name,
      file: task.filepath,
      status: task.result?.status,
    },
    error: errors[0],
    errors,
    artifacts: {
      trace: artifacts.tracePath,
      summary: artifacts.summaryPath,
      debug: artifacts.debugPath,
    },
    command: {
      showTrace: showTraceCommand,
    },
    note: 'trace.zip is the official Playwright trace artifact. Use the command above to inspect actions, DOM snapshots, screenshots, console, and network details.',
  };

  await writeFile(
    artifacts.summaryPath,
    `${JSON.stringify(summary, undefined, 2)}\n`,
  );

  await writeFile(
    artifacts.debugPath,
    [
      '# Playwright Trace Debug Report',
      '',
      '## Test',
      '',
      `- Name: ${task.name}`,
      `- File: ${task.filepath ?? 'unknown'}`,
      `- Status: ${task.result?.status ?? 'unknown'}`,
      '',
      '## Open Trace',
      '',
      '```bash',
      showTraceCommand,
      '```',
      '',
      '## Error',
      '',
      errors.length
        ? errors
            .map((error) =>
              [`### ${error.name ?? 'Error'}`, '', error.message ?? ''].join(
                '\n',
              ),
            )
            .join('\n\n')
        : 'No Rstest error was recorded for this test.',
      '',
      '## AI Debugging Notes',
      '',
      "- `trace.zip` is Playwright's official trace artifact, not a generic Chrome/Perfetto trace.",
      '- Inspect it with Playwright Trace Viewer for actions, DOM snapshots, screenshots, console, and network details.',
      '- Use `trace-summary.json` for Rstest-aware test metadata and error stacks.',
      '',
    ].join('\n'),
  );
};

const printTraceSavedMessage = (
  artifacts: TraceArtifacts,
  task: TestContext['task'],
) => {
  const projectRoot = task.projectRoot ?? process.cwd();
  const tracePath = formatRelativePath(projectRoot, artifacts.tracePath);

  console.log(`[rstest-playwright] Trace saved: ${tracePath}`);
  if (artifacts.options.print) {
    console.log(
      `[rstest-playwright] View trace: ${getShowTraceCommand(artifacts, projectRoot)}`,
    );
  }
};

export const resolveLaunchOptions = ({
  debug,
  launchOptions,
}: PlaywrightOptions): LaunchOptions => {
  const debugOptions = getDebugOptions(debug);

  return {
    ...launchOptions,
    ...(debugOptions
      ? {
          headless: false,
          slowMo: debugOptions.slowMo ?? 100,
          devtools: debugOptions.devtools ?? true,
        }
      : {}),
  };
};

const getBrowserCacheKey = (options: PlaywrightOptions) =>
  JSON.stringify({
    browserName: options.browserName ?? DEFAULT_BROWSER_NAME,
    launchOptions: resolveLaunchOptions(options),
  });

const getBrowser = (options: PlaywrightOptions) => {
  const browserName = options.browserName ?? DEFAULT_BROWSER_NAME;
  const key = getBrowserCacheKey(options);
  const cachedBrowser = browserCache.get(key);

  if (cachedBrowser) {
    return cachedBrowser;
  }

  const browser = browserTypes[browserName].launch(
    resolveLaunchOptions(options),
  );
  browserCache.set(key, browser);
  return browser;
};

const closeBrowser = async (): Promise<void> => {
  const browsers = [...browserCache.values()];
  browserCache.clear();

  await Promise.all(browsers.map(async (browser) => (await browser).close()));
};

const getRealTimers = () => {
  try {
    const realTimers = rstest.getRealTimers();

    return {
      setTimeout:
        realTimers.setTimeout ?? globalThis.setTimeout.bind(globalThis),
      clearTimeout:
        realTimers.clearTimeout ?? globalThis.clearTimeout.bind(globalThis),
    };
  } catch {
    return {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
  }
};

const clearBrowserCleanupTimer = () => {
  if (browserCleanupTimer) {
    getRealTimers().clearTimeout(browserCleanupTimer);
    browserCleanupTimer = undefined;
  }
};

const closeBrowserWhenIdle = async () => {
  if (activeBrowserFixtureCount > 0 || browserCache.size === 0) {
    return;
  }

  browserCleanupPromise ??= closeBrowser().finally(() => {
    browserCleanupPromise = undefined;
  });

  await browserCleanupPromise;
};

const scheduleBrowserCleanupWhenIdle = () => {
  if (activeBrowserFixtureCount > 0 || browserCache.size === 0) {
    return;
  }

  clearBrowserCleanupTimer();
  browserCleanupTimer = getRealTimers().setTimeout(() => {
    browserCleanupTimer = undefined;
    void closeBrowserWhenIdle();
  }, BROWSER_IDLE_CLOSE_DELAY);
};

const retainBrowser = () => {
  clearBrowserCleanupTimer();
  activeBrowserFixtureCount++;
  let released = false;

  return async (scheduleCleanup: boolean) => {
    if (released) {
      return;
    }

    released = true;
    activeBrowserFixtureCount--;

    if (scheduleCleanup) {
      scheduleBrowserCleanupWhenIdle();
    } else {
      await closeBrowserWhenIdle();
    }
  };
};

const createStaticServerClose = (server: Server) => {
  let closePromise: Promise<void> | undefined;

  return () => {
    closePromise ??= new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return closePromise;
  };
};

const listenStaticServer = async (
  server: Server,
  host: string,
  port: number,
) => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();

  const urlHost = host.includes(':') ? `[${host}]` : host;

  if (!address || typeof address === 'string') {
    return `http://${urlHost}:${port}`;
  }

  return `http://${urlHost}:${address.port}`;
};

const resolveStaticFile = async (root: string, pathName: string) => {
  const decodedPath = (() => {
    try {
      return decodeURIComponent(pathName);
    } catch {
      return;
    }
  })();

  if (!decodedPath) {
    return;
  }

  const filePath = resolve(
    root,
    decodedPath === '/' ? 'index.html' : `.${decodedPath}`,
  );
  const relativePath = relative(root, filePath);

  if (
    relativePath.startsWith('..') ||
    relativePath.startsWith(sep) ||
    isAbsolute(relativePath)
  ) {
    return;
  }

  const fileStat = await stat(filePath).catch(() => undefined);

  if (!fileStat?.isFile()) {
    return;
  }

  return filePath;
};

const startStaticServer = async (
  entry: string,
  {
    headers,
    host = DEFAULT_STATIC_SERVER_HOST,
    port = 0,
  }: PlaywrightServeOptions = {},
  projectRoot = process.cwd(),
): Promise<PlaywrightServeResult> => {
  const entryPath = isAbsolute(entry) ? entry : resolve(projectRoot, entry);
  const entryStat = await stat(entryPath);
  const root = entryStat.isDirectory() ? entryPath : dirname(entryPath);
  const indexFile = entryStat.isDirectory()
    ? join(entryPath, 'index.html')
    : entryPath;

  const server = createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(404).end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? host}`);
    const filePath =
      url.pathname === '/'
        ? indexFile
        : await resolveStaticFile(root, url.pathname);

    if (!filePath) {
      response.writeHead(404).end();
      return;
    }

    const content = await readFile(filePath).catch(() => undefined);

    if (!content) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, {
      'content-type':
        CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      ...headers,
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  });

  const origin = await listenStaticServer(server, host, port);
  const entryUrl = entryStat.isDirectory()
    ? origin
    : `${origin}/${encodeURIComponent(basename(entryPath))}`;

  const close = createStaticServerClose(server);

  return {
    url: basename(indexFile) === 'index.html' ? origin : entryUrl,
    close,
  };
};

const cleanupServer = async ({
  keepAliveOnDebug,
  playwright,
  server,
}: {
  keepAliveOnDebug?: boolean;
  playwright: PlaywrightOptions;
  server: PlaywrightServeResult;
}) => {
  if (keepAliveOnDebug !== false && isDebugEnabled(playwright.debug)) {
    console.log(
      `[rstest-playwright] Keep server alive for debugging: ${server.url}`,
    );
    return;
  }

  await server.close();
};

const defaultPlaywrightFixture = async (
  _context: TestContext,
  use: (options: PlaywrightOptions) => Promise<void>,
) => {
  await use({ browserName: DEFAULT_BROWSER_NAME });
};

const cleanupBrowserFixture = [
  async (
    { onTestFailed, task }: TestContext,
    use: (value: undefined) => Promise<void>,
  ) => {
    const release = retainBrowser();

    onTestFailed(async () => {
      await release(false);
    }, DEBUG_PAUSE_TIMEOUT);

    try {
      await use(undefined);
    } finally {
      if (task.result?.status !== 'fail') {
        await release(true);
      }
    }
  },
  { auto: true },
] satisfies Fixtures<
  { cleanupBrowser: undefined },
  PlaywrightFixture
>['cleanupBrowser'];

const playwrightFixtures = {
  cleanupBrowser: cleanupBrowserFixture,
  playwright: defaultPlaywrightFixture,

  browser: async (
    { playwright }: TestContext & Pick<PlaywrightFixture, 'playwright'>,
    use: (browser: Browser) => Promise<void>,
  ) => {
    const browser = await getBrowser(playwright);
    await use(browser);
  },

  context: async (
    {
      browser,
      onTestFailed,
      onTestFinished,
      playwright,
      task,
    }: TestContext & Pick<PlaywrightFixture, 'browser' | 'playwright'>,
    use: (context: BrowserContext) => Promise<void>,
  ) => {
    const context = await browser.newContext(playwright.contextOptions);
    const artifacts = getTraceArtifacts(playwright, task);
    let activeArtifacts: TraceArtifacts | undefined;
    let traceStarted = false;
    let released = false;
    let finalized = false;
    let traceReported = false;
    let releaseBrowser: ReturnType<typeof retainBrowser> | undefined;
    let stagedTraceDir: string | undefined;
    let stagedTracePath: string | undefined;

    const finalizeTrace = async () => {
      if (!activeArtifacts || finalized) {
        return;
      }

      if (activeArtifacts.options.summary) {
        await writeTraceSummary({ artifacts: activeArtifacts, task });
      }

      if (!traceReported) {
        printTraceSavedMessage(activeArtifacts, task);
        traceReported = true;
      }

      finalized = true;
    };

    const finishContextCleanup = async (scheduleBrowserCleanup: boolean) => {
      try {
        if (stagedTraceDir && stagedTracePath) {
          try {
            if (task.result?.status === 'fail' && artifacts) {
              activeArtifacts = await reserveTraceArtifacts(artifacts);
              try {
                await copyFile(stagedTracePath, activeArtifacts.tracePath);
              } catch (error) {
                await rm(activeArtifacts.dir, {
                  recursive: true,
                  force: true,
                });
                activeArtifacts = undefined;
                throw error;
              }
            }
          } finally {
            await rm(stagedTraceDir, { recursive: true, force: true });
            stagedTraceDir = undefined;
            stagedTracePath = undefined;
          }
        }

        await finalizeTrace();
      } finally {
        await releaseBrowser?.(scheduleBrowserCleanup);
      }
    };

    const cleanupContext = async () => {
      if (released) {
        await finishContextCleanup(task.result?.status !== 'fail');
        return;
      }

      released = true;

      try {
        try {
          if (artifacts && traceStarted) {
            const shouldSaveTrace =
              artifacts.options.mode === 'on' || task.result?.status === 'fail';
            const shouldStageTrace =
              artifacts.options.mode === 'retain-on-failure' &&
              task.result?.status !== 'fail';

            if (shouldSaveTrace) {
              activeArtifacts = await reserveTraceArtifacts(artifacts);
              try {
                await context.tracing.stop({ path: activeArtifacts.tracePath });
              } catch (error) {
                await rm(activeArtifacts.dir, { recursive: true, force: true });
                activeArtifacts = undefined;
                throw error;
              }
            } else if (shouldStageTrace) {
              stagedTraceDir = await mkdtemp(
                join(tmpdir(), 'rstest-playwright-trace-'),
              );
              stagedTracePath = join(stagedTraceDir, 'trace.zip');
              try {
                await context.tracing.stop({ path: stagedTracePath });
              } catch (error) {
                await rm(stagedTraceDir, { recursive: true, force: true });
                stagedTraceDir = undefined;
                stagedTracePath = undefined;
                throw error;
              }
            } else {
              await context.tracing.stop();
            }
          }
        } finally {
          await context.close();
        }
      } catch (error) {
        if (task.result?.status === 'fail') {
          await finishContextCleanup(false);
        }
        throw error;
      }

      await finishContextCleanup(task.result?.status !== 'fail');
    };

    onTestFailed(cleanupContext, 0);

    if (artifacts) {
      try {
        await context.tracing.start({
          screenshots: artifacts.options.screenshots,
          snapshots: artifacts.options.snapshots,
          sources: artifacts.options.sources,
          title: task.name,
        });
        traceStarted = true;
      } catch (error) {
        await cleanupContext();
        throw error;
      }
    }

    try {
      await use(context);
    } finally {
      if (task.result?.status !== 'fail') {
        releaseBrowser = retainBrowser();
        onTestFinished(async () => {
          if (task.result?.status !== 'fail') {
            await cleanupContext();
          }
        }, 0);
      }
    }
  },

  page: async (
    {
      context,
      onTestFailed,
      playwright,
      task,
    }: TestContext & Pick<PlaywrightFixture, 'context' | 'playwright'>,
    use: (page: Page) => Promise<void>,
  ) => {
    const page = await context.newPage();

    onTestFailed(async () => {
      if (!shouldPauseOnFailure(playwright)) {
        await page.close();
        return;
      }

      console.log('[rstest-playwright] Paused on failed test for debugging.');
      await page.pause();
      await page.close();
    }, DEBUG_PAUSE_TIMEOUT);

    try {
      await use(page);
    } finally {
      if (task.result?.status !== 'fail') {
        await page.close();
      }
    }
  },

  request: async (
    {
      onTestFailed,
      playwright,
      task,
    }: TestContext & Pick<PlaywrightFixture, 'playwright'>,
    use: (request: APIRequestContext) => Promise<void>,
  ) => {
    const request = await playwrightRequest.newContext(
      playwright.requestOptions,
    );
    let released = false;

    const cleanupRequest = async () => {
      if (released) {
        return;
      }

      released = true;
      await request.dispose();
    };

    onTestFailed(cleanupRequest);

    try {
      await use(request);
    } finally {
      if (task.result?.status !== 'fail') {
        await cleanupRequest();
      }
    }
  },

  serve: async (
    {
      onTestFailed,
      playwright,
      task,
    }: TestContext & Pick<PlaywrightFixture, 'playwright'>,
    use: (serve: PlaywrightServe) => Promise<void>,
  ) => {
    const servers: {
      keepAliveOnDebug?: boolean;
      released: boolean;
      server: PlaywrightServeResult;
    }[] = [];

    const cleanupServers = async () => {
      const errors: unknown[] = [];

      for (const entry of servers.toReversed()) {
        if (entry.released) {
          continue;
        }

        entry.released = true;
        try {
          await cleanupServer({
            ...entry,
            playwright,
          });
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length === 1) {
        throw errors[0];
      }
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Failed to close Playwright servers.');
      }
    };

    onTestFailed(cleanupServers);

    const serve: PlaywrightServe = async (entry, options) => {
      const server = await startStaticServer(entry, options, task.projectRoot);

      servers.push({
        keepAliveOnDebug: options?.keepAliveOnDebug,
        released: false,
        server,
      });

      return server;
    };

    try {
      await use(serve);
    } finally {
      if (task.result?.status !== 'fail') {
        await cleanupServers();
      }
    }
  },
};

type RstestTest<ExtraContext = object> = TestAPIs<ExtraContext>;
type TestCallback<ExtraContext> = (
  context: TestContext & ExtraContext,
) => void | Promise<void>;
type TestForCallback<ExtraContext> = (
  param: unknown,
  context: TestContext & ExtraContext,
) => void | Promise<void>;
type RstestTestAPI<ExtraContext> =
  RstestTest<ExtraContext> | TestAPIs<ExtraContext>;
type CallableTest = (
  description: string,
  arg2?: unknown,
  arg3?: unknown,
) => void;
type RstestGlobal = typeof globalThis & {
  RSTEST_API?: {
    test?: {
      extend?: unknown;
    };
  };
};

type MaybeLocalExpectContext = TestContext & {
  _useLocalExpect?: boolean;
};

const getExpectForContext = (context: TestContext) => {
  const maybeLocalExpectContext = context as MaybeLocalExpectContext;
  const globalState = rstestExpect.getState();

  if (maybeLocalExpectContext._useLocalExpect) {
    return context.expect;
  }

  if (
    globalState.assertionCalls > 0 ||
    globalState.expectedAssertionsNumber !== null ||
    globalState.isExpectingAssertions
  ) {
    return rstestExpect;
  }

  return context.expect;
};

const hasExpectContext = (context: unknown): context is TestContext =>
  (typeof context === 'object' || typeof context === 'function') &&
  context !== null &&
  'expect' in context;

const preserveFixtureSource = <Fn extends (...args: never[]) => unknown>(
  original: Fn,
  wrapped: Fn,
): Fn => {
  Object.defineProperty(wrapped, 'toString', {
    configurable: true,
    value: () => original.toString(),
  });
  return wrapped;
};

const splitByTopLevelComma = (source: string) => {
  const result: string[] = [];
  const stack: string[] = [];
  let start = 0;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '{' || char === '[' || char === '(') {
      stack.push(char === '{' ? '}' : char === '[' ? ']' : ')');
    } else if (char === stack[stack.length - 1]) {
      stack.pop();
    } else if (!stack.length && char === ',') {
      const token = source.substring(start, i).trim();
      if (token) {
        result.push(token);
      }
      start = i + 1;
    }
  }

  const token = source.substring(start).trim();
  if (token) {
    result.push(token);
  }

  return result;
};

const getFunctionParameterSource = (fn: (...args: never[]) => unknown) => {
  const match = /(?:async)?(?:\s+function)?[^(]*\(([^)]*)/.exec(fn.toString());

  return match ? splitByTopLevelComma(match[1]!.trim()) : [];
};

const stripCommentsAndStrings = (source: string) => {
  let result = '';
  let quote: '"' | "'" | '`' | undefined;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      if (char === '\\') {
        result += '  ';
        i++;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      result += char === '\n' ? '\n' : ' ';
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        result += ' ';
        i++;
      }
      result += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      result += '  ';
      i++;
      while (i + 1 < source.length) {
        if (source[i] === '*' && source[i + 1] === '/') {
          result += '  ';
          i++;
          break;
        }
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      result += ' ';
      continue;
    }

    result += char;
  }

  return result;
};

const getPropertyFixtureParam = (
  source: string,
  contextParam: string | undefined,
) => {
  const match = /^[$A-Z_a-z][$\w]*$/.exec(contextParam ?? '');
  if (!match) {
    return '_';
  }

  const fixtureProps = new Set<string>();
  const escapedParam = match[0].replaceAll('$', '\\$');
  const propertyPattern = new RegExp(
    `(?<![$\\w])${escapedParam}\\s*(?:\\?\\.|\\.)\\s*([$A-Z_a-z][$\\w]*)`,
    'g',
  );
  const destructurePattern = new RegExp(
    `(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${escapedParam}(?![$\\w])`,
    'g',
  );
  const strippedSource = stripCommentsAndStrings(source);

  for (const propertyMatch of strippedSource.matchAll(propertyPattern)) {
    fixtureProps.add(propertyMatch[1]!);
  }

  for (const destructureMatch of strippedSource.matchAll(destructurePattern)) {
    for (const prop of splitByTopLevelComma(destructureMatch[1]!)) {
      const name = prop.split(':', 1)[0]!.trim();
      if (name && !name.startsWith('...')) {
        fixtureProps.add(name);
      }
    }
  }

  return fixtureProps.size ? `{ ${Array.from(fixtureProps).join(', ')} }` : '_';
};

const preserveForFixtureSource = <Fn extends (...args: never[]) => unknown>(
  original: Fn,
  wrapped: Fn,
): Fn => {
  const [, contextParam] = getFunctionParameterSource(original);
  const fixtureParam = contextParam?.startsWith('{')
    ? contextParam
    : getPropertyFixtureParam(original.toString(), contextParam);

  Object.defineProperty(wrapped, 'toString', {
    configurable: true,
    value: () => `(${fixtureParam}) => {}`,
  });

  return wrapped;
};

const preserveEachFixtureSource = <Fn extends (...args: never[]) => unknown>(
  wrapped: Fn,
): Fn => {
  Object.defineProperty(wrapped, 'toString', {
    configurable: true,
    value: () => `(${TEST_EACH_CONTEXT_PARAM}) => {}`,
  });

  return wrapped;
};

const isFixtureOptions = (value: unknown) => {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'auto')
  );
};

const isFixtureTuple = (fixture: readonly unknown[]) => {
  return (
    (fixture.length === 1 && typeof fixture[0] === 'function') ||
    isFixtureOptions(fixture[1])
  );
};

const wrapTestContextCallback = <Fn extends (...args: any[]) => unknown>(
  fn: Fn,
): Fn => {
  return preserveFixtureSource(fn, (async (...args: Parameters<Fn>) => {
    const [context] = args as unknown as [TestContext | object, ...unknown[]];
    const result = hasExpectContext(context)
      ? await withPlaywrightExpect(
          () => getExpectForContext(context),
          () => fn(...args),
        )
      : await fn(...args);

    return typeof result === 'function'
      ? wrapTestContextCallback(result as (...args: any[]) => unknown)
      : result;
  }) as Fn);
};

const wrapFixtureEntry = <T>(fixture: T): T => {
  if (Array.isArray(fixture)) {
    if (!isFixtureTuple(fixture)) {
      return fixture;
    }

    const [value, ...options] = fixture;

    return [
      typeof value === 'function'
        ? wrapTestContextCallback(value as (...args: any[]) => unknown)
        : value,
      ...options,
    ] as T;
  }

  return typeof fixture === 'function'
    ? (wrapTestContextCallback(
        fixture as (...args: any[]) => unknown,
      ) as unknown as T)
    : fixture;
};

const wrapFixtures = <T extends Record<string, any>, ExtraContext>(
  fixtures: PlaywrightFixtures<T, ExtraContext>,
): PlaywrightFixtures<T, ExtraContext> => {
  return Object.fromEntries(
    Object.entries(fixtures).map(([key, value]) => [
      key,
      wrapFixtureEntry(value),
    ]),
  ) as PlaywrightFixtures<T, ExtraContext>;
};

export type PlaywrightFixtures<
  FixturesContext extends Record<string, any>,
  ExtraContext,
> = Fixtures<FixturesContext, ExtraContext>;

type PlaywrightTestBase<ExtraContext> = Omit<
  RstestTest<ExtraContext>,
  'each' | 'extend' | 'fail' | 'fails' | 'for'
> & {
  (
    description: string,
    fn?: (context: TestContext & ExtraContext) => void | Promise<void>,
    timeout?: number,
  ): void;
  (
    description: string,
    options: TestOptions,
    fn?: (context: TestContext & ExtraContext) => void | Promise<void>,
  ): void;
  each: RstestTest<ExtraContext>['each'];
  fail: PlaywrightTestBase<ExtraContext>;
  fails: PlaywrightTestBase<ExtraContext>;
  for: TestForFn<ExtraContext>;
};

type RstestAfterAll = typeof rstestAfterAll;
type RstestAfterEach = typeof rstestAfterEach;
type RstestBeforeAll = typeof rstestBeforeAll;
type RstestBeforeEach = typeof rstestBeforeEach;
type RstestDescribe = typeof rstestDescribe;

const wrapBeforeAll = (hook: RstestBeforeAll): RstestBeforeAll => {
  return ((fn, timeout) =>
    hook(wrapTestContextCallback(fn), timeout)) as RstestBeforeAll;
};

const wrapAfterAll = (hook: RstestAfterAll): RstestAfterAll => {
  return ((fn, timeout) =>
    hook(wrapTestContextCallback(fn), timeout)) as RstestAfterAll;
};

const wrapAfterEach = (hook: RstestAfterEach): RstestAfterEach => {
  return ((fn, timeout) =>
    hook(wrapTestContextCallback(fn), timeout)) as RstestAfterEach;
};

const wrapBeforeEach = (hook: RstestBeforeEach): RstestBeforeEach => {
  return ((fn, timeout) =>
    hook(wrapTestContextCallback(fn), timeout)) as RstestBeforeEach;
};

type MergeContext<ExtraContext, FixturesContext> = {
  [
    K in keyof FixturesContext | keyof ExtraContext
  ]: K extends keyof FixturesContext
    ? FixturesContext[K]
    : K extends keyof ExtraContext
      ? ExtraContext[K]
      : never;
};

export type PlaywrightTest<ExtraContext = PlaywrightFixture> =
  PlaywrightTestBase<ExtraContext> & {
    extend: <T extends Record<string, any> = object>(
      fixtures: PlaywrightFixtures<T, ExtraContext>,
    ) => PlaywrightTest<MergeContext<ExtraContext, T>>;
    afterAll: typeof rstestAfterAll;
    afterEach: typeof rstestAfterEach;
    beforeAll: typeof rstestBeforeAll;
    beforeEach: typeof rstestBeforeEach;
    describe: typeof rstestDescribe;
    fail: PlaywrightTestBase<ExtraContext>;
  };

const createPlaywrightTest = <ExtraContext>(
  rstestTest: RstestTestAPI<ExtraContext>,
): PlaywrightTest<ExtraContext> => {
  const wrapTestCallback = (
    fn: TestCallback<ExtraContext>,
  ): TestCallback<ExtraContext> => {
    return preserveFixtureSource(fn, ((context) =>
      withPlaywrightExpect(
        () => getExpectForContext(context),
        () => fn(context),
      )) as typeof fn);
  };
  const wrapEachCallback = <Fn extends (...args: any[]) => unknown>(
    fn: Fn,
  ): Fn => {
    const wrapped = preserveEachFixtureSource(((...args) => {
      const context = args[args.length - 1] as TestContext | undefined;

      return hasExpectContext(context)
        ? withPlaywrightExpect(
            () => getExpectForContext(context),
            () => fn(...args.slice(0, -1)),
          )
        : fn(...args);
    }) as Fn);

    Object.defineProperty(wrapped, TEST_EACH_CONTEXT_SYMBOL, {
      value: true,
    });

    return wrapped;
  };
  const wrapEachTestCall = (
    testCall: ReturnType<RstestTest<ExtraContext>['each']>,
  ): ReturnType<RstestTest<ExtraContext>['each']> => {
    return ((description, arg2, arg3) => {
      if (typeof arg2 === 'function') {
        return (testCall as CallableTest)(
          description,
          wrapEachCallback(arg2),
          arg3 as number | undefined,
        );
      }

      return (testCall as CallableTest)(
        description,
        arg2,
        typeof arg3 === 'function' ? wrapEachCallback(arg3) : undefined,
      );
    }) as ReturnType<RstestTest<ExtraContext>['each']>;
  };
  const wrapForCallback = (
    fn: TestForCallback<ExtraContext>,
  ): TestForCallback<ExtraContext> => {
    return preserveForFixtureSource(fn, ((param, context) =>
      withPlaywrightExpect(
        () => getExpectForContext(context),
        () => fn(param, context),
      )) as typeof fn);
  };
  const wrapForTestCall = (
    testCall: ReturnType<TestForFn<ExtraContext>>,
  ): ReturnType<TestForFn<ExtraContext>> => {
    return ((description, arg2, arg3) => {
      if (typeof arg2 === 'function') {
        return (testCall as CallableTest)(
          description,
          wrapForCallback(arg2 as TestForCallback<ExtraContext>),
          arg3 as number | undefined,
        );
      }

      return (testCall as CallableTest)(
        description,
        arg2,
        typeof arg3 === 'function'
          ? wrapForCallback(arg3 as TestForCallback<ExtraContext>)
          : undefined,
      );
    }) as ReturnType<TestForFn<ExtraContext>>;
  };
  return new Proxy(rstestTest, {
    apply(target, _thisArg, args) {
      const [description, arg2, arg3] = args;

      if (typeof arg2 === 'function') {
        return target(
          description as string,
          wrapTestCallback(arg2 as TestCallback<ExtraContext>),
          arg3 as number | undefined,
        );
      }

      return target(
        description as string,
        arg2 as TestOptions,
        typeof arg3 === 'function'
          ? wrapTestCallback(arg3 as TestCallback<ExtraContext>)
          : undefined,
      );
    },
    get(target, key, receiver) {
      if (key === 'afterAll') {
        return wrapAfterAll(rstestAfterAll);
      }
      if (key === 'afterEach') {
        return wrapAfterEach(rstestAfterEach);
      }
      if (key === 'beforeAll') {
        return wrapBeforeAll(rstestBeforeAll);
      }
      if (key === 'beforeEach') {
        return wrapBeforeEach(rstestBeforeEach);
      }
      if (key === 'describe') {
        return rstestDescribe;
      }
      if (key === 'extend') {
        const extend =
          'extend' in target ? target.extend.bind(target) : undefined;

        return extend
          ? (fixtures: Parameters<PlaywrightTest<ExtraContext>['extend']>[0]) =>
              createPlaywrightTest(extend(wrapFixtures(fixtures)))
          : undefined;
      }
      if (key === 'fail') {
        const fails = target.fails;
        return typeof fails === 'function'
          ? createPlaywrightTest(
              fails as unknown as RstestTestAPI<ExtraContext>,
            )
          : fails;
      }
      if (
        key === 'fails' ||
        key === 'only' ||
        key === 'skip' ||
        key === 'todo' ||
        key === 'concurrent' ||
        key === 'sequential'
      ) {
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function'
          ? createPlaywrightTest(value as RstestTestAPI<ExtraContext>)
          : value;
      }
      if (key === 'runIf' || key === 'skipIf') {
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function'
          ? (condition: boolean) =>
              createPlaywrightTest(
                value(condition) as RstestTestAPI<ExtraContext>,
              )
          : value;
      }
      if (key === 'each') {
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function'
          ? (...args: Parameters<RstestTest<ExtraContext>['each']>) =>
              wrapEachTestCall(value(...args))
          : value;
      }
      if (key === 'for') {
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function'
          ? (...args: Parameters<TestForFn<ExtraContext>>) =>
              wrapForTestCall(value(...args))
          : value;
      }

      return Reflect.get(target, key, receiver);
    },
  }) as unknown as PlaywrightTest<ExtraContext>;
};

const getPlaywrightBase = () =>
  base.extend<PlaywrightFixture>(playwrightFixtures);

const hasPlaywrightBase = () =>
  typeof (globalThis as RstestGlobal).RSTEST_API?.test?.extend === 'function';

const lazyPlaywrightBase = new Proxy(base as RstestTestAPI<PlaywrightFixture>, {
  apply(_target, thisArg, args) {
    if (!hasPlaywrightBase()) {
      return Reflect.apply(base, thisArg, args);
    }

    return Reflect.apply(getPlaywrightBase(), thisArg, args);
  },
  get(_target, key, receiver) {
    if (!hasPlaywrightBase()) {
      return Reflect.get(base, key, receiver);
    }

    return Reflect.get(getPlaywrightBase(), key, receiver);
  },
  has(_target, key) {
    return hasPlaywrightBase() && key === 'extend';
  },
});

export const test: PlaywrightTest = createPlaywrightTest(lazyPlaywrightBase);

export const afterAll: RstestAfterAll = wrapAfterAll(rstestAfterAll);
export const afterEach: RstestAfterEach = wrapAfterEach(rstestAfterEach);
export const beforeAll: RstestBeforeAll = wrapBeforeAll(rstestBeforeAll);
export const beforeEach: RstestBeforeEach = wrapBeforeEach(rstestBeforeEach);
export const describe: RstestDescribe = rstestDescribe;
