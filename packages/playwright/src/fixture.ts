import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
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
const DEBUG_PAUSE_TIMEOUT = 24 * 60 * 60 * 1000;
const BROWSER_IDLE_CLOSE_DELAY = 1000;
const DEFAULT_STATIC_SERVER_HOST = '127.0.0.1';
const TEST_EACH_CONTEXT_SYMBOL = Symbol.for('rstest.test.each.context');

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

  if (!address || typeof address === 'string') {
    return `http://${host}:${port}`;
  }

  return `http://${host}:${address.port}`;
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
): Promise<PlaywrightServeResult> => {
  const entryPath = resolve(entry);
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
    : `${origin}/${basename(entryPath)}`;

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
    clearBrowserCleanupTimer();
    activeBrowserFixtureCount++;
    let released = false;

    const release = async (scheduleCleanup: boolean) => {
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
      const server = await startStaticServer(entry, options);

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
      playwright,
      task,
    }: TestContext & Pick<PlaywrightFixture, 'browser' | 'playwright'>,
    use: (context: BrowserContext) => Promise<void>,
  ) => {
    const context = await browser.newContext(playwright.contextOptions);
    onTestFailed(async () => {
      await context.close();
    });

    try {
      await use(context);
    } finally {
      if (task.result?.status !== 'fail') {
        await context.close();
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

const preserveForFixtureSource = <Fn extends (...args: never[]) => unknown>(
  original: Fn,
  wrapped: Fn,
): Fn => {
  const [, contextParam] = getFunctionParameterSource(original);

  Object.defineProperty(wrapped, 'toString', {
    configurable: true,
    value: () => `(${contextParam ?? '_'}) => {}`,
  });

  return wrapped;
};

const preserveEachFixtureSource = <Fn extends (...args: never[]) => unknown>(
  wrapped: Fn,
): Fn => {
  Object.defineProperty(wrapped, 'toString', {
    configurable: true,
    value: () => '() => {}',
  });

  return wrapped;
};

const wrapTestContextCallback = <Fn extends (...args: any[]) => unknown>(
  fn: Fn,
): Fn => {
  return preserveFixtureSource(fn, (async (...args: Parameters<Fn>) => {
    const [context] = args as unknown as [TestContext | object, ...unknown[]];
    const expect = 'expect' in context ? context.expect : undefined;
    const result = expect
      ? await withPlaywrightExpect(expect, () => fn(...args))
      : await fn(...args);

    return typeof result === 'function'
      ? wrapTestContextCallback(result as (...args: any[]) => unknown)
      : result;
  }) as Fn);
};

const wrapFixtureEntry = <T>(fixture: T): T => {
  if (Array.isArray(fixture)) {
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
      withPlaywrightExpect(context.expect, () => fn(context))) as typeof fn);
  };
  const wrapEachCallback = <Fn extends (...args: any[]) => unknown>(
    fn: Fn,
  ): Fn => {
    const wrapped = preserveEachFixtureSource(((...args) => {
      const context = args[args.length - 1] as TestContext | undefined;

      return context?.expect
        ? withPlaywrightExpect(context.expect, () => fn(...args))
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
      withPlaywrightExpect(context.expect, () =>
        fn(param, context),
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
