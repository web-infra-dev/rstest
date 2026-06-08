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
  test as base,
} from '@rstest/core';
import type { TestContext } from '@rstest/core';
import { chromium, request as playwrightRequest } from 'playwright';
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

type BrowserCache = {
  key: string;
  promise: Promise<Browser>;
};

const DEFAULT_PLAYWRIGHT_OPTIONS = {
  browserName: 'chromium',
} satisfies PlaywrightOptions;

const DEBUG_ENV = 'RSTEST_PLAYWRIGHT_DEBUG';
const PAUSE_ENV = 'RSTEST_PLAYWRIGHT_PAUSE';
const DEBUG_PAUSE_TIMEOUT = 24 * 60 * 60 * 1000;
const DEFAULT_STATIC_SERVER_HOST = '127.0.0.1';

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

let browserCache: BrowserCache | undefined;

const browserTypes = {
  chromium,
} satisfies Record<PlaywrightBrowserName, BrowserType>;

const getDebugOptions = (debug: PlaywrightOptions['debug']) => {
  const normalizedDebug = debug ?? process.env[DEBUG_ENV] === 'true';

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

const resolveLaunchOptions = ({
  debug,
  launchOptions,
}: PlaywrightOptions): LaunchOptions => {
  const debugOptions = getDebugOptions(debug);

  return {
    channel: process.env.CI ? 'chrome' : undefined,
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
    browserName: options.browserName,
    launchOptions: resolveLaunchOptions(options),
  });

const getBrowser = (options: PlaywrightOptions) => {
  const browserName = options.browserName ?? 'chromium';
  const key = getBrowserCacheKey(options);

  if (browserCache?.key !== key) {
    browserCache = {
      key,
      promise: browserTypes[browserName].launch(resolveLaunchOptions(options)),
    };
  }

  return browserCache.promise;
};

const closeBrowser = async () => {
  if (!browserCache) {
    return;
  }

  const browser = await browserCache.promise;
  browserCache = undefined;
  await browser.close();
};

rstestAfterAll(closeBrowser);

const closeStaticServer = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

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
  const decodedPath = decodeURIComponent(pathName);
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

  return {
    url: basename(indexFile) === 'index.html' ? origin : entryUrl,
    close: () => closeStaticServer(server),
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

const playwrightFixtures = {
  playwright: DEFAULT_PLAYWRIGHT_OPTIONS,

  serve: async (
    { playwright }: TestContext & Pick<PlaywrightFixture, 'playwright'>,
    use: (serve: PlaywrightServe) => Promise<void>,
  ) => {
    const servers: {
      keepAliveOnDebug?: boolean;
      server: PlaywrightServeResult;
    }[] = [];

    const serve: PlaywrightServe = async (entry, options) => {
      const server = await startStaticServer(entry, options);

      servers.push({
        keepAliveOnDebug: options?.keepAliveOnDebug,
        server,
      });

      return server;
    };

    try {
      await use(serve);
    } finally {
      for (const server of servers.toReversed()) {
        await cleanupServer({
          ...server,
          playwright,
        });
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
      playwright,
      task,
    }: TestContext & Pick<PlaywrightFixture, 'browser' | 'playwright'>,
    use: (context: BrowserContext) => Promise<void>,
  ) => {
    const context = await browser.newContext(playwright.contextOptions);
    try {
      await use(context);
    } finally {
      if (shouldPauseOnFailure(playwright) && task.result?.status === 'fail') {
        return;
      }

      await context.close();
    }
  },

  page: async (
    {
      context,
      playwright,
      onTestFailed,
      task,
    }: TestContext & Pick<PlaywrightFixture, 'context' | 'playwright'>,
    use: (page: Page) => Promise<void>,
  ) => {
    const page = await context.newPage();

    onTestFailed(async () => {
      if (!shouldPauseOnFailure(playwright)) {
        return;
      }

      console.log('[rstest-playwright] Paused on failed test for debugging.');
      await page.pause();
    }, DEBUG_PAUSE_TIMEOUT);

    try {
      await use(page);
    } finally {
      if (shouldPauseOnFailure(playwright) && task.result?.status === 'fail') {
        return;
      }

      await page.close();
    }
  },

  request: async (
    { playwright }: TestContext & Pick<PlaywrightFixture, 'playwright'>,
    use: (request: APIRequestContext) => Promise<void>,
  ) => {
    const request = await playwrightRequest.newContext(
      playwright.requestOptions,
    );
    try {
      await use(request);
    } finally {
      await request.dispose();
    }
  },
};

type TestCallbackFn<ExtraContext = object> = (
  context: TestContext & ExtraContext,
) => void | Promise<void>;

type PlaywrightTestFn = (
  description: string,
  fn?: TestCallbackFn<PlaywrightFixture>,
  options?: Parameters<typeof base>[2],
) => void;

type RstestTest = typeof base;
type RstestAfterAll = typeof rstestAfterAll;
type RstestAfterEach = typeof rstestAfterEach;
type RstestBeforeAll = typeof rstestBeforeAll;
type RstestBeforeEach = typeof rstestBeforeEach;
type RstestDescribe = typeof rstestDescribe;

type FixtureOptions = {
  auto?: boolean;
};

type Fixture<FixturesContext, K extends keyof FixturesContext, ExtraContext> =
  | FixturesContext[K]
  | ((
      context: Omit<FixturesContext, K> & ExtraContext & TestContext,
      use: (value: FixturesContext[K]) => Promise<void>,
    ) => Promise<void>);

type RstestFixtures<
  FixturesContext extends Record<string, any>,
  ExtraContext,
> = {
  [K in keyof FixturesContext]?:
    | Fixture<FixturesContext, K, ExtraContext>
    | [Fixture<FixturesContext, K, ExtraContext>, FixtureOptions?];
};

type MergeContext<ExtraContext, FixturesContext> = {
  [K in
    | keyof FixturesContext
    | keyof ExtraContext]: K extends keyof FixturesContext
    ? FixturesContext[K]
    : K extends keyof ExtraContext
      ? ExtraContext[K]
      : never;
};

type PlaywrightTestSkip = PlaywrightTestFn &
  (() => void) &
  Omit<RstestTest['skip'], 'skip'> & {
    skip: PlaywrightTestSkip;
  };

export type PlaywrightTest = PlaywrightTestFn &
  Omit<RstestTest, 'extend' | 'skip'> & {
    extend: <T extends Record<string, any> = object>(
      fixtures: RstestFixtures<T, PlaywrightFixture>,
    ) => PlaywrightTestFn &
      Omit<PlaywrightTest, 'extend'> & {
        extend: <U extends Record<string, any> = object>(
          fixtures: RstestFixtures<U, MergeContext<PlaywrightFixture, T>>,
        ) => PlaywrightTestFn;
      };
    afterAll: typeof rstestAfterAll;
    afterEach: typeof rstestAfterEach;
    beforeAll: typeof rstestBeforeAll;
    beforeEach: typeof rstestBeforeEach;
    describe: typeof rstestDescribe;
    fail: RstestTest['fails'];
    skip: PlaywrightTestSkip;
  };

const createPlaywrightTest = (rstestTest: RstestTest): PlaywrightTest => {
  const playwrightTest = rstestTest as unknown as PlaywrightTest;
  const extend = rstestTest.extend.bind(rstestTest);

  Object.assign(playwrightTest, {
    afterAll: rstestAfterAll,
    afterEach: rstestAfterEach,
    beforeAll: rstestBeforeAll,
    beforeEach: rstestBeforeEach,
    describe: rstestDescribe,
    fail: rstestTest.fails,
  });

  playwrightTest.extend = ((fixtures: Parameters<RstestTest['extend']>[0]) => {
    return createPlaywrightTest(extend(fixtures) as RstestTest);
  }) as PlaywrightTest['extend'];

  return playwrightTest;
};

export const test: PlaywrightTest = createPlaywrightTest(
  base.extend<PlaywrightFixture>(playwrightFixtures) as RstestTest,
);

export const afterAll: RstestAfterAll = rstestAfterAll;
export const afterEach: RstestAfterEach = rstestAfterEach;
export const beforeAll: RstestBeforeAll = rstestBeforeAll;
export const beforeEach: RstestBeforeEach = rstestBeforeEach;
export const describe: RstestDescribe = rstestDescribe;
