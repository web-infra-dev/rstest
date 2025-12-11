import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { RsbuildDevServer, RsbuildInstance } from '@rsbuild/core';
import { createRsbuild, rspack } from '@rsbuild/core';
import { type BirpcReturn, createBirpc } from 'birpc';
import openEditor from 'open-editor';
import { dirname, join, relative, resolve, sep } from 'pathe';
import * as picomatch from 'picomatch';
import type {
  BrowserContext,
  ConsoleMessage,
  Frame,
  Page,
} from 'playwright-core';
import sirv from 'sirv';
import { type WebSocket, WebSocketServer } from 'ws';
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
  BrowserProjectRuntime,
} from './protocol';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Type Definitions
// ============================================================================

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

type BindingSource = {
  context: BrowserContext;
  page: Page;
  frame: Frame;
};

/** RPC methods exposed by the host (server) to the container (client) */
type HostRpcMethods = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<string[]>;
};

/** RPC methods exposed by the container (client) to the host (server) */
type ContainerRpcMethods = {
  onTestFileUpdate: (testFiles: string[]) => Promise<void>;
  reloadTestFile: (testFile: string, testNamePattern?: string) => Promise<void>;
};

type ContainerRpc = BirpcReturn<ContainerRpcMethods, HostRpcMethods>;

// ============================================================================
// RPC Manager - Encapsulates WebSocket and birpc management
// ============================================================================

/**
 * Manages the WebSocket connection and birpc communication with the container UI.
 * Provides a clean interface for sending RPC calls and handling connections.
 */
class ContainerRpcManager {
  private wss: WebSocketServer;
  private ws: WebSocket | null = null;
  private rpc: ContainerRpc | null = null;
  private methods: HostRpcMethods;

  constructor(wss: WebSocketServer, methods: HostRpcMethods) {
    this.wss = wss;
    this.methods = methods;
    this.setupConnectionHandler();
  }

  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.log(color.gray('[Browser UI] Container WebSocket connected'));
      this.attachWebSocket(ws);
    });
  }

  private attachWebSocket(ws: WebSocket): void {
    this.ws = ws;

    this.rpc = createBirpc<ContainerRpcMethods, HostRpcMethods>(this.methods, {
      post: (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(data));
        }
      },
      on: (fn) => {
        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message.toString());
            fn(data);
          } catch {
            // ignore invalid messages
          }
        });
      },
    });

    ws.on('close', () => {
      this.ws = null;
      this.rpc = null;
    });
  }

  /** Check if a container is currently connected */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === this.ws.OPEN;
  }

  /** Get the current WebSocket instance (for reuse in watch mode) */
  get currentWebSocket(): WebSocket | null {
    return this.ws;
  }

  /** Reattach an existing WebSocket (for watch mode reuse) */
  reattach(ws: WebSocket): void {
    this.attachWebSocket(ws);
  }

  /** Notify container of test file changes */
  async notifyTestFileUpdate(files: string[]): Promise<void> {
    await this.rpc?.onTestFileUpdate(files);
  }

  /** Request container to reload a specific test file */
  async reloadTestFile(
    testFile: string,
    testNamePattern?: string,
  ): Promise<void> {
    await this.rpc?.reloadTestFile(testFile, testNamePattern);
  }
}

// ============================================================================
// Browser Runtime - Core runtime state
// ============================================================================

type BrowserRuntime = {
  rsbuildInstance: RsbuildInstance;
  devServer: RsbuildDevServer;
  browser: ChromiumBrowserInstance;
  port: number;
  wsPort: number;
  manifestPath: string;
  tempDir: string;
  manifestPlugin: VirtualModulesPluginInstance;
  containerPage?: Page;
  containerContext?: BrowserContext;
  setContainerOptions: (options: BrowserHostConfig) => void;
  wss: WebSocketServer;
  rpcManager?: ContainerRpcManager;
};

// ============================================================================
// Watch Mode Context - Encapsulates all watch mode state
// ============================================================================

type WatchContext = {
  runtime: BrowserRuntime | null;
  lastTestFiles: string[];
  hooksEnabled: boolean;
  cleanupRegistered: boolean;
};

const watchContext: WatchContext = {
  runtime: null,
  lastTestFiles: [],
  hooksEnabled: false,
  cleanupRegistered: false,
};

// ============================================================================
// Utility Functions
// ============================================================================

const ensureProcessExitCode = (code: number): void => {
  if (process.exitCode === undefined || process.exitCode === 0) {
    process.exitCode = code;
  }
};

const toPosix = (path: string): string => path.split(sep).join('/');

/**
 * Convert a single glob pattern to RegExp using picomatch
 * Based on Storybook's implementation
 */
const globToRegexp = (glob: string): RegExp => {
  const regex = picomatch.makeRe(glob, {
    fastpaths: false,
    noglobstar: false,
    bash: false,
  });

  if (!regex) {
    throw new Error(`Invalid glob pattern: ${glob}`);
  }

  // picomatch generates regex starting with ^
  // For patterns starting with ./, we need special handling
  if (!glob.startsWith('./')) {
    return regex;
  }

  // makeRe is sort of funny. If you pass it a directory starting with `./` it
  // creates a matcher that expects files with no prefix (e.g. `src/file.js`)
  // but if you pass it a directory that starts with `../` it expects files that
  // start with `../`. Let's make it consistent.
  // Globs starting `**` need special treatment due to the regex they produce
  return new RegExp(
    [
      '^\\.',
      glob.startsWith('./**') ? '' : '[\\\\/]',
      regex.source.substring(1),
    ].join(''),
  );
};

/**
 * Convert rstest include glob patterns to RegExp for import.meta.webpackContext
 * Uses picomatch for robust glob-to-regexp conversion
 */
const globPatternsToRegExp = (patterns: string[]): RegExp => {
  const regexParts = patterns.map((pattern) => {
    const regex = globToRegexp(pattern);
    // Remove ^ anchor and $ anchor to allow combining patterns
    let source = regex.source;
    if (source.startsWith('^')) {
      source = source.substring(1);
    }
    if (source.endsWith('$')) {
      source = source.substring(0, source.length - 1);
    }
    return source;
  });

  return new RegExp(`(?:${regexParts.join('|')})$`);
};

/**
 * Convert exclude patterns to a RegExp for import.meta.webpackContext's exclude option
 * This is used at compile time to filter out files during bundling
 *
 * Example:
 *   Input: ['**\/node_modules\/**', '**\/dist\/**']
 *   Output: /[\\/](node_modules|dist)[\\/]/
 */
const excludePatternsToRegExp = (patterns: string[]): RegExp | null => {
  const keywords: string[] = [];
  for (const pattern of patterns) {
    // Extract the core part between ** wildcards
    // e.g., '**/node_modules/**' -> 'node_modules'
    // e.g., '**/dist/**' -> 'dist'
    // e.g., '**/.{idea,git,cache,output,temp}/**' -> extract each part
    const match = pattern.match(
      /\*\*\/\.?\{?([^/*{}]+(?:,[^/*{}]+)*)\}?\/?\*?\*?/,
    );
    if (match) {
      // Handle {a,b,c} patterns
      const parts = match[1]!.split(',');
      for (const part of parts) {
        // Clean up the part (remove leading dots for hidden dirs)
        const cleaned = part.replace(/^\./, '');
        if (cleaned && !keywords.includes(cleaned)) {
          keywords.push(cleaned);
        }
      }
    }
  }

  if (keywords.length === 0) {
    return null;
  }

  // Create regex that matches paths containing these directory names
  // Use [\\/] to match both forward and back slashes
  return new RegExp(`[\\\\/](${keywords.join('|')})[\\\\/]`);
};

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

// ============================================================================
// Manifest Generation
// ============================================================================

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

  const lines: string[] = [];

  // Currently only handle the first project (multi-project support later)
  const { project, setupFiles } = entries[0]!;

  // 1. Project config
  lines.push('export const projectConfig = {');
  lines.push(`  name: ${JSON.stringify(project.name)},`);
  lines.push(`  environmentName: ${JSON.stringify(project.environmentName)},`);
  lines.push(`  projectRoot: ${JSON.stringify(toPosix(project.rootPath))},`);
  lines.push('};');
  lines.push('');

  // 2. Setup files - static imports (small number, determined at startup)
  lines.push('export const setupLoaders = [');
  for (const filePath of setupFiles) {
    const relativePath = toRelativeImport(filePath);
    lines.push(`  () => import(${JSON.stringify(relativePath)}),`);
  }
  lines.push('];');
  lines.push('');

  // 3. Test files context - using import.meta.webpackContext with lazy mode
  // Use absolute path for clarity and reliability
  const projectRootPosix = toPosix(project.rootPath);
  const includeRegExp = globPatternsToRegExp(project.normalizedConfig.include);
  const excludePatterns = project.normalizedConfig.exclude.patterns;
  const excludeRegExp = excludePatternsToRegExp(excludePatterns);

  lines.push('// Test files context with lazy loading');
  lines.push(
    `const testContext = import.meta.webpackContext(${JSON.stringify(projectRootPosix)}, {`,
  );
  lines.push('  recursive: true,');
  lines.push(`  regExp: ${includeRegExp.toString()},`);
  if (excludeRegExp) {
    lines.push(`  exclude: ${excludeRegExp.toString()},`);
  }
  lines.push("  mode: 'lazy',");
  lines.push('});');
  lines.push('');

  // 4. Export APIs
  lines.push('export const getTestKeys = () => testContext.keys();');
  lines.push('export const loadTest = (key) => testContext(key);');

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

// ============================================================================
// Browser Runtime Lifecycle
// ============================================================================

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
  try {
    runtime.wss?.close();
  } catch {
    // ignore
  }
  await fs
    .rm(runtime.tempDir, { recursive: true, force: true })
    .catch(() => {});
};

const registerWatchCleanup = (): void => {
  if (watchContext.cleanupRegistered) {
    return;
  }

  const cleanup = async () => {
    if (!watchContext.runtime) {
      return;
    }
    await destroyBrowserRuntime(watchContext.runtime);
    watchContext.runtime = null;
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void cleanup();
    });
  }

  process.once('exit', () => {
    void cleanup();
  });

  watchContext.cleanupRegistered = true;
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

  // Collect plugins from all projects (e.g., pluginReact for JSX support)
  const userPlugins = context.projects.flatMap(
    (project) => project.normalizedConfig.plugins || [],
  );

  const rsbuildInstance = await createRsbuild({
    callerName: 'rstest-browser',
    rsbuildConfig: {
      root: context.rootPath,
      mode: 'development',
      plugins: userPlugins,
      server: {
        printUrls: false,
        port: context.normalizedConfig.browser.port,
        strictPort: context.normalizedConfig.browser.port !== undefined,
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
                  imports: true,
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
          api.onBeforeDevCompile(() => {
            if (!watchContext.hooksEnabled) {
              return;
            }
            logger.log(color.cyan('\nFile changed, re-running tests...\n'));
          });

          api.onAfterDevCompile(async () => {
            if (!watchContext.hooksEnabled) {
              return;
            }
            await onTriggerRerun();
          });
        },
      },
    ]);
  }

  const devServer = await rsbuildInstance.createDevServer({
    getPortSilently: true,
  });

  // Serve prebuilt container assets (SPA) via sirv
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

  // Create WebSocket server on a different port
  const wsPort = port + 1;
  const wss = new WebSocketServer({ port: wsPort });
  logger.log(
    color.gray(`[Browser UI] WebSocket server started on port ${wsPort}`),
  );

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
    wsPort,
    manifestPath,
    tempDir,
    manifestPlugin: virtualManifestPlugin,
    setContainerOptions,
    wss,
  };
};

// ============================================================================
// Main Entry Point
// ============================================================================

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

  // Track initial test files for watch mode
  if (isWatchMode) {
    watchContext.lastTestFiles = projectEntries
      .flatMap((entry) => entry.testFiles)
      .sort();
  }

  let runtime = isWatchMode ? watchContext.runtime : null;

  // Define rerun callback for watch mode (will be populated later)
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
      watchContext.runtime = runtime;
      registerWatchCleanup();
    }
  }

  const { browser, port, wsPort, wss } = runtime;
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

  const hostOptions: BrowserHostConfig = {
    rootPath: context.rootPath,
    projects: projectRuntimeConfigs,
    snapshot: {
      updateSnapshot: context.snapshotManager.options.updateSnapshot,
    },
    runnerUrl: `http://localhost:${port}`,
    wsPort,
  };

  runtime.setContainerOptions(hostOptions);

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

    // Prevent popup windows from being created
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

    // Setup communication to receive test results from iframes
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
            break;
        }
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

  // Setup RPC manager
  let rpcManager: ContainerRpcManager;

  if (isWatchMode && runtime.rpcManager) {
    rpcManager = runtime.rpcManager;
    // Reattach if we have an existing WebSocket
    const existingWs = rpcManager.currentWebSocket;
    if (existingWs) {
      rpcManager.reattach(existingWs);
    }
  } else {
    rpcManager = new ContainerRpcManager(wss, {
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
    });

    if (isWatchMode) {
      runtime.rpcManager = rpcManager;
    }
  }

  // Only navigate on first creation
  if (isNewPage) {
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

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  const testTime = Date.now() - testStart;

  // Define rerun logic for watch mode
  if (isWatchMode) {
    triggerRerun = async () => {
      const newProjectEntries = await collectProjectEntries(context);
      const currentTestFiles = newProjectEntries
        .flatMap((entry) => entry.testFiles)
        .sort();

      const filesChanged =
        currentTestFiles.length !== watchContext.lastTestFiles.length ||
        currentTestFiles.some(
          (file, index) => file !== watchContext.lastTestFiles[index],
        );

      if (filesChanged) {
        watchContext.lastTestFiles = currentTestFiles;
        await rpcManager.notifyTestFileUpdate(currentTestFiles);
      }

      logger.log(color.cyan('Tests will be re-executed automatically\n'));
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

  // Enable watch hooks AFTER initial test run to avoid duplicate runs
  if (isWatchMode && triggerRerun) {
    watchContext.hooksEnabled = true;
    logger.log(
      color.cyan('\nWatch mode enabled - will re-run tests on file changes\n'),
    );
  }
};
