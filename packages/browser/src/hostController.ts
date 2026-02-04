import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  type BrowserTestRunOptions,
  type BrowserTestRunResult,
  color,
  type FormattedError,
  getSetupFiles,
  getTestEntries,
  isDebug,
  type ListCommandResult,
  loadCoverageProvider,
  logger,
  type ProjectContext,
  type Reporter,
  type Rstest,
  type RuntimeConfig,
  rsbuild,
  serializableConfig,
  TEMP_RSTEST_OUTPUT_DIR,
  type Test,
  type TestFileResult,
  type TestResult,
  type UserConsoleLog,
} from '@rstest/core/browser';
import { type BirpcReturn, createBirpc } from 'birpc';
import openEditor from 'open-editor';
import { basename, dirname, join, normalize, relative, resolve } from 'pathe';
import * as picomatch from 'picomatch';
import sirv from 'sirv';
import { type WebSocket, WebSocketServer } from 'ws';
import { getHeadlessConcurrency } from './concurrency';
import {
  createHostDispatchRouter,
  type HostDispatchRouterOptions,
} from './dispatchCapabilities';
import { createHeadlessLatestRerunScheduler } from './headlessLatestRerunScheduler';
import { attachHeadlessRunnerTransport } from './headlessTransport';
import type {
  BrowserClientMessage,
  BrowserDispatchHandler,
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  BrowserProjectRuntime,
  BrowserRpcRequest,
  BrowserViewport,
  SnapshotRpcRequest,
  TestFileInfo,
} from './protocol';
import {
  type BrowserProvider,
  type BrowserProviderBrowser,
  type BrowserProviderContext,
  type BrowserProviderImplementation,
  type BrowserProviderPage,
  getBrowserProviderImplementation,
} from './providers';
import {
  createRunSession,
  type RunSession,
  RunSessionLifecycle,
} from './runSession';
import { RunnerSessionRegistry } from './sessionRegistry';
import {
  loadSourceMapWithCache,
  normalizeJavaScriptUrl,
  type SourceMapPayload,
} from './sourceMap/sourceMapLoader';
import { resolveBrowserViewportPreset } from './viewportPresets';
import { collectWatchTestFiles, planWatchRerun } from './watchRerunPlanner';

const { createRsbuild, rspack } = rsbuild;
type RsbuildDevServer = rsbuild.RsbuildDevServer;
type RsbuildInstance = rsbuild.RsbuildInstance;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIONS_PLACEHOLDER = '__RSTEST_OPTIONS_PLACEHOLDER__';

/**
 * Serialize JSON for inline <script> injection.
 * Escapes '<' to prevent accidental </script> break-out.
 * Escapes U+2028/U+2029 to keep script parsing safe.
 */
const serializeForInlineScript = (value: unknown): string => {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
};

// ============================================================================
// Type Definitions
// ============================================================================

type VirtualModulesPluginInstance = InstanceType<
  (typeof rspack.experiments)['VirtualModulesPlugin']
>;

type BrowserProjectEntries = {
  project: ProjectContext;
  setupFiles: string[];
  testFiles: string[];
};

type BrowserProviderProject = {
  rootPath: string;
  provider: BrowserProvider;
};

type BrowserLaunchOptions = Pick<
  ProjectContext['normalizedConfig']['browser'],
  'provider' | 'browser' | 'headless' | 'port' | 'strictPort'
>;

/** Payload for test file start event */
type TestFileStartPayload = {
  testPath: string;
  projectName: string;
};

/** Payload for log event */
type LogPayload = {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  content: string;
  testPath: string;
  type: 'stdout' | 'stderr';
  trace?: string;
};

/** Payload for fatal error event */
type FatalPayload = {
  message: string;
  stack?: string;
};

type ReporterHookArg<THook extends keyof Reporter> = Parameters<
  NonNullable<Reporter[THook]>
>[0];

type TestFileReadyPayload = ReporterHookArg<'onTestFileReady'>;
type TestSuiteStartPayload = ReporterHookArg<'onTestSuiteStart'>;
type TestSuiteResultPayload = ReporterHookArg<'onTestSuiteResult'>;
type TestCaseStartPayload = ReporterHookArg<'onTestCaseStart'>;

/** RPC methods exposed by the host (server) to the container (client) */
type HostRpcMethods = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<TestFileInfo[]>;
  // Test result callbacks from container
  onTestFileStart: (payload: TestFileStartPayload) => Promise<void>;
  onTestCaseResult: (payload: TestResult) => Promise<void>;
  onTestFileComplete: (payload: TestFileResult) => Promise<void>;
  onLog: (payload: LogPayload) => Promise<void>;
  onFatal: (payload: FatalPayload) => Promise<void>;
  // Generic dispatch endpoint used by runner RPC requests.
  dispatch: (
    request: BrowserDispatchRequest,
  ) => Promise<BrowserDispatchResponse>;
};

/** RPC methods exposed by the container (client) to the host (server) */
type ContainerRpcMethods = {
  onTestFileUpdate: (testFiles: TestFileInfo[]) => Promise<void>;
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

  /** Update the RPC methods (used when starting a new test run) */
  updateMethods(methods: HostRpcMethods): void {
    this.methods = methods;
    // Re-create birpc with new methods if already connected
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.attachWebSocket(this.ws);
    }
  }

  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.debug('[Browser UI] Container WebSocket connected');
      logger.debug(
        `[Browser UI] Current ws: ${this.ws ? 'exists' : 'null'}, new ws: ${ws ? 'exists' : 'null'}`,
      );
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
      // Only clear if this is still the active connection
      // This prevents a race condition when a new connection is established
      // before the old one's close event fires
      if (this.ws === ws) {
        this.ws = null;
        this.rpc = null;
      }
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
  async notifyTestFileUpdate(files: TestFileInfo[]): Promise<void> {
    await this.rpc?.onTestFileUpdate(files);
  }

  /** Request container to reload a specific test file */
  async reloadTestFile(
    testFile: string,
    testNamePattern?: string,
  ): Promise<void> {
    logger.debug(
      `[Browser UI] reloadTestFile called, rpc: ${this.rpc ? 'exists' : 'null'}, ws: ${this.ws ? 'exists' : 'null'}`,
    );
    if (!this.rpc) {
      logger.debug('[Browser UI] RPC not available, skipping reloadTestFile');
      return;
    }
    logger.debug(`[Browser UI] Calling reloadTestFile: ${testFile}`);
    await this.rpc.reloadTestFile(testFile, testNamePattern);
  }
}

// ============================================================================
// Browser Runtime - Core runtime state
// ============================================================================

type BrowserRuntime = {
  rsbuildInstance: RsbuildInstance;
  devServer: RsbuildDevServer;
  browser: BrowserProviderBrowser;
  port: number;
  wsPort: number;
  manifestPath: string;
  tempDir: string;
  manifestPlugin: VirtualModulesPluginInstance;
  containerPage?: BrowserProviderPage;
  containerContext?: BrowserProviderContext;
  setContainerOptions: (options: BrowserHostConfig) => void;
  // Reserved extension seam for host-side dispatch capabilities.
  dispatchHandlers: Map<string, BrowserDispatchHandler>;
  wss: WebSocketServer;
  rpcManager?: ContainerRpcManager;
};

// ============================================================================
// Watch Mode Context - Encapsulates all watch mode state
// ============================================================================

type WatchContext = {
  runtime: BrowserRuntime | null;
  lastTestFiles: TestFileInfo[];
  hooksEnabled: boolean;
  cleanupRegistered: boolean;
  chunkHashes: Map<string, string>;
  affectedTestFiles: string[];
};

const watchContext: WatchContext = {
  runtime: null,
  lastTestFiles: [],
  hooksEnabled: false,
  cleanupRegistered: false,
  chunkHashes: new Map(),
  affectedTestFiles: [],
};

// ============================================================================
// Utility Functions
// ============================================================================

const resolveViewport = (
  viewport: BrowserViewport | undefined,
): { width: number; height: number } | null => {
  if (!viewport) {
    return null;
  }

  if (typeof viewport === 'string') {
    return resolveBrowserViewportPreset(viewport);
  }

  if (
    typeof viewport.width === 'number' &&
    Number.isFinite(viewport.width) &&
    viewport.width > 0 &&
    typeof viewport.height === 'number' &&
    Number.isFinite(viewport.height) &&
    viewport.height > 0
  ) {
    return {
      width: viewport.width,
      height: viewport.height,
    };
  }

  return null;
};

const mapViewportByProject = (
  projects: BrowserProjectRuntime[],
): Map<string, { width: number; height: number }> => {
  const map = new Map<string, { width: number; height: number }>();
  for (const project of projects) {
    const viewport = resolveViewport(project.viewport);
    if (viewport) {
      map.set(project.name, viewport);
    }
  }
  return map;
};

const ensureProcessExitCode = (code: number): void => {
  if (process.exitCode === undefined || process.exitCode === 0) {
    process.exitCode = code;
  }
};

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

type StatsModule = {
  nameForCondition?: string;
  children?: StatsModule[];
};

type StatsChunk = {
  id?: string | number;
  names?: string[];
  hash?: string;
  files?: string[];
  modules?: StatsModule[];
};

/**
 * Find test file path from chunk modules by matching against known entry files.
 */
const findTestFileInModules = (
  modules: StatsModule[] | undefined,
  entryTestFiles: Set<string>,
): string | null => {
  if (!modules) return null;

  for (const m of modules) {
    if (m.nameForCondition) {
      const normalizedPath = normalize(m.nameForCondition);
      if (entryTestFiles.has(normalizedPath)) {
        return normalizedPath;
      }
    }
    if (m.children) {
      const found = findTestFileInModules(m.children, entryTestFiles);
      if (found) return found;
    }
  }
  return null;
};

/**
 * Get a stable identifier for a chunk.
 * Prefers chunk.id or chunk.names[0] over file paths for stability.
 */
const getChunkKey = (chunk: StatsChunk): string | null => {
  if (chunk.id != null) {
    return String(chunk.id);
  }
  if (chunk.names && chunk.names.length > 0) {
    return chunk.names[0]!;
  }
  if (chunk.files && chunk.files.length > 0) {
    return chunk.files[0]!;
  }
  return null;
};

/**
 * Compare chunk hashes and find affected test files for watch mode re-runs.
 * Uses chunk.id/names as stable keys instead of relying on file path patterns.
 */
const getAffectedTestFiles = (
  chunks: StatsChunk[] | undefined,
  entryTestFiles: Set<string>,
): string[] => {
  if (!chunks) return [];

  const affectedFiles = new Set<string>();
  const currentHashes = new Map<string, string>();

  for (const chunk of chunks) {
    if (!chunk.hash) continue;

    // First check if this chunk contains a test entry file
    const testFile = findTestFileInModules(chunk.modules, entryTestFiles);
    if (!testFile) continue;

    // Get a stable key for this chunk
    const chunkKey = getChunkKey(chunk);
    if (!chunkKey) continue;

    const prevHash = watchContext.chunkHashes.get(chunkKey);
    currentHashes.set(chunkKey, chunk.hash);

    if (prevHash !== undefined && prevHash !== chunk.hash) {
      affectedFiles.add(testFile);
      logger.debug(
        `[Watch] Chunk hash changed for ${chunkKey}: ${prevHash} -> ${chunk.hash} (test: ${testFile})`,
      );
    }
  }

  watchContext.chunkHashes = currentHashes;
  return Array.from(affectedFiles);
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
    includeTaskLocation,
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
    includeTaskLocation,
  };
};

const getBrowserProjects = (context: Rstest): ProjectContext[] => {
  return context.projects.filter(
    (project) => project.normalizedConfig.browser.enabled,
  );
};

const getBrowserLaunchOptions = (
  project: ProjectContext,
): BrowserLaunchOptions => ({
  provider: project.normalizedConfig.browser.provider,
  browser: project.normalizedConfig.browser.browser,
  headless: project.normalizedConfig.browser.headless,
  port: project.normalizedConfig.browser.port,
  strictPort: project.normalizedConfig.browser.strictPort,
});

const ensureConsistentBrowserLaunchOptions = (
  projects: ProjectContext[],
): BrowserLaunchOptions => {
  if (projects.length === 0) {
    throw new Error('No browser-enabled projects found.');
  }

  const firstProject = projects[0]!;
  const firstOptions = getBrowserLaunchOptions(firstProject);

  for (const project of projects.slice(1)) {
    const options = getBrowserLaunchOptions(project);
    if (
      options.provider !== firstOptions.provider ||
      options.browser !== firstOptions.browser ||
      options.headless !== firstOptions.headless ||
      options.port !== firstOptions.port ||
      options.strictPort !== firstOptions.strictPort
    ) {
      throw new Error(
        `Browser launch config mismatch between projects "${firstProject.name}" and "${project.name}". ` +
          'All browser-enabled projects in one run must share provider/browser/headless/port/strictPort.',
      );
    }
  }

  return firstOptions;
};

const resolveProviderForTestPath = ({
  testPath,
  browserProjects,
}: {
  testPath: string;
  browserProjects: BrowserProviderProject[];
}): BrowserProvider => {
  const normalizedTestPath = normalize(testPath);
  const sortedProjects = [...browserProjects].sort(
    (a, b) => b.rootPath.length - a.rootPath.length,
  );

  for (const project of sortedProjects) {
    if (normalizedTestPath.startsWith(project.rootPath)) {
      return project.provider;
    }
  }

  throw new Error(
    `Cannot resolve browser provider for test path: ${JSON.stringify(testPath)}. ` +
      `Known project roots: ${JSON.stringify(sortedProjects.map((p) => p.rootPath))}`,
  );
};

const collectProjectEntries = async (
  context: Rstest,
): Promise<BrowserProjectEntries[]> => {
  const projectEntries: BrowserProjectEntries[] = [];

  // Only collect entries for browser mode projects
  const browserProjects = getBrowserProjects(context);

  for (const project of browserProjects) {
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
  // __dirname points to packages/browser/dist when running from built code
  // or packages/browser/src when running from source
  const candidates = [
    // When running from built dist: look in ../src for source files
    resolve(__dirname, '../src', relativePath),
    // When running from source (dev mode)
    resolve(__dirname, relativePath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve browser client file: ${relativePath}`);
};

const resolveContainerDist = (): string => {
  // When running from built dist: browser-container is in the same dist folder
  const distPath = resolve(__dirname, 'browser-container');
  if (existsSync(distPath)) {
    return distPath;
  }

  throw new Error(
    `Browser container build not found at ${distPath}. Please run "pnpm --filter @rstest/browser build".`,
  );
};

// ============================================================================
// Manifest Generation
// ============================================================================

/**
 * Format environment name to a valid JavaScript identifier.
 * Replaces non-alphanumeric characters with underscores.
 */
const toSafeVarName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
};

const generateManifestModule = ({
  manifestPath,
  entries,
}: {
  manifestPath: string;
  entries: BrowserProjectEntries[];
}): string => {
  const manifestDirPosix = normalize(dirname(manifestPath));

  const toRelativeImport = (filePath: string): string => {
    const posixPath = normalize(filePath);
    let relativePath = relative(manifestDirPosix, posixPath);
    if (!relativePath.startsWith('.')) {
      relativePath = `./${relativePath}`;
    }
    return relativePath;
  };

  const lines: string[] = [];

  // 1. Export all projects configuration
  lines.push('// All projects configuration');
  lines.push('export const projects = [');
  for (const { project } of entries) {
    lines.push('  {');
    lines.push(`    name: ${JSON.stringify(project.name)},`);
    lines.push(
      `    environmentName: ${JSON.stringify(project.environmentName)},`,
    );
    lines.push(
      `    projectRoot: ${JSON.stringify(normalize(project.rootPath))},`,
    );
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');

  // 2. Setup loaders for each project
  lines.push('// Setup loaders for each project');
  lines.push('export const projectSetupLoaders = {');
  for (const { project, setupFiles } of entries) {
    lines.push(`  ${JSON.stringify(project.name)}: [`);
    for (const filePath of setupFiles) {
      const relativePath = toRelativeImport(filePath);
      lines.push(`    () => import(${JSON.stringify(relativePath)}),`);
    }
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');

  // 3. Test context for each project
  lines.push('// Test context for each project');
  for (const { project } of entries) {
    const varName = `context_${toSafeVarName(project.environmentName)}`;
    const projectRootPosix = normalize(project.rootPath);
    const includeRegExp = globPatternsToRegExp(
      project.normalizedConfig.include,
    );
    const excludePatterns = project.normalizedConfig.exclude.patterns;
    const excludeRegExp = excludePatternsToRegExp(excludePatterns);

    lines.push(
      `const ${varName} = import.meta.webpackContext(${JSON.stringify(projectRootPosix)}, {`,
    );
    lines.push('  recursive: true,');
    lines.push(`  regExp: ${includeRegExp.toString()},`);
    if (excludeRegExp) {
      lines.push(`  exclude: ${excludeRegExp.toString()},`);
    }
    lines.push("  mode: 'lazy',");
    lines.push('});');
    lines.push('');
  }

  // 4. Export test contexts object
  lines.push('export const projectTestContexts = {');
  for (const { project } of entries) {
    const varName = `context_${toSafeVarName(project.environmentName)}`;
    lines.push(`  ${JSON.stringify(project.name)}: {`);
    lines.push(`    getTestKeys: () => ${varName}.keys(),`);
    lines.push(`    loadTest: (key) => ${varName}(key),`);
    lines.push(
      `    projectRoot: ${JSON.stringify(normalize(project.rootPath))},`,
    );
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');

  // 5. Backward compatibility exports (use first project as default)
  lines.push('// Backward compatibility: export first project as default');
  lines.push('export const projectConfig = projects[0];');
  lines.push(
    'export const setupLoaders = projectSetupLoaders[projects[0].name] || [];',
  );
  lines.push('const _defaultCtx = projectTestContexts[projects[0].name];');
  lines.push(
    'export const getTestKeys = () => _defaultCtx ? _defaultCtx.getTestKeys() : [];',
  );
  lines.push(
    'export const loadTest = (key) => _defaultCtx ? _defaultCtx.loadTest(key) : Promise.reject(new Error("No project found"));',
  );

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

// Workaround for noisy "removed ..." logs caused by VirtualModulesPlugin.
// Rsbuild suppresses the removed-file log if all removed paths include "virtual":
// https://github.com/web-infra-dev/rsbuild/blob/1258fa9dba5c321a4629b591a6dadbd2e26c6963/packages/core/src/createCompiler.ts#L73-L76
const VIRTUAL_MANIFEST_FILENAME = 'virtual-manifest.ts';

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
  forceHeadless,
}: {
  context: Rstest;
  manifestPath: string;
  manifestSource: string;
  tempDir: string;
  isWatchMode: boolean;
  onTriggerRerun?: () => Promise<void>;
  containerDistPath?: string;
  containerDevServer?: string;
  /** Force headless mode regardless of user config (used for list command) */
  forceHeadless?: boolean;
}): Promise<BrowserRuntime> => {
  const virtualManifestPlugin = new rspack.experiments.VirtualModulesPlugin({
    [manifestPath]: manifestSource,
  });

  const containerHtmlTemplate = containerDistPath
    ? await fs.readFile(join(containerDistPath, 'index.html'), 'utf-8')
    : null;

  let injectedContainerHtml: string | null = null;
  let serializedOptions = 'null';
  // Reserved extension seam for future browser-side capabilities.
  const dispatchHandlers = new Map<string, BrowserDispatchHandler>();

  const setContainerOptions = (options: BrowserHostConfig): void => {
    serializedOptions = serializeForInlineScript(options);
    if (containerHtmlTemplate) {
      injectedContainerHtml = containerHtmlTemplate.replace(
        OPTIONS_PLACEHOLDER,
        serializedOptions,
      );
    }
  };

  const browserProjects = getBrowserProjects(context);
  const projectByEnvironmentName = new Map(
    browserProjects.map((project) => [project.environmentName, project]),
  );
  const userPlugins = browserProjects.flatMap(
    (project) => project.normalizedConfig.plugins || [],
  );
  const browserLaunchOptions =
    ensureConsistentBrowserLaunchOptions(browserProjects);

  // Rstest internal aliases that must not be overridden by user config
  const browserRuntimePath = fileURLToPath(
    import.meta.resolve('@rstest/core/browser-runtime'),
  );

  const rstestInternalAliases = {
    '@rstest/browser-manifest': manifestPath,
    // User test code: import { describe, it } from '@rstest/core'
    '@rstest/core': resolveBrowserFile('client/public.ts'),
    // User test code: import { page } from '@rstest/browser'
    '@rstest/browser': resolveBrowserFile('browser.ts'),
    // Browser runtime APIs for entry.ts and public.ts
    // Uses dist file with extractSourceMap to preserve sourcemap chain for inline snapshots
    '@rstest/core/browser-runtime': browserRuntimePath,
    '@sinonjs/fake-timers': resolveBrowserFile('client/fakeTimersStub.ts'),
  };

  const rsbuildInstance = await createRsbuild({
    callerName: 'rstest-browser',
    rsbuildConfig: {
      root: context.rootPath,
      mode: 'development',
      plugins: userPlugins,
      server: {
        printUrls: false,
        port: browserLaunchOptions.port ?? 4000,
        strictPort: browserLaunchOptions.strictPort,
      },
      dev: {
        client: {
          logLevel: 'error',
        },
      },
      environments: {
        ...Object.fromEntries(
          browserProjects.map((project) => [project.environmentName, {}]),
        ),
      },
    },
  });

  // Add plugin to merge user Rsbuild config with rstest required config
  rsbuildInstance.addPlugins([
    {
      name: 'rstest:browser-user-config',
      setup(api) {
        // Internal extension entry: register host dispatch handlers without
        // coupling scheduling to individual capability implementations.
        (api as { expose?: (name: string, value: unknown) => void }).expose?.(
          'rstest:browser',
          {
            registerDispatchHandler: (
              namespace: string,
              handler: BrowserDispatchHandler,
            ) => {
              dispatchHandlers.set(namespace, handler);
            },
          },
        );

        api.modifyEnvironmentConfig({
          handler: (config, { mergeEnvironmentConfig, name }) => {
            const project = projectByEnvironmentName.get(name);
            if (!project) {
              return config;
            }

            const userRsbuildConfig = project.normalizedConfig;
            // Merge order: current config -> userConfig -> rstest required config (highest priority)
            const merged = mergeEnvironmentConfig(config, userRsbuildConfig, {
              resolve: {
                alias: rstestInternalAliases,
              },
              source: {
                define: {
                  'process.env': 'globalThis[Symbol.for("rstest.env")]',
                  'import.meta.env': 'globalThis[Symbol.for("rstest.env")]',
                },
              },
              output: {
                target: 'web',
                // Enable source map for inline snapshot support
                sourceMap: {
                  js: 'source-map',
                },
              },
              tools: {
                rspack: (rspackConfig) => {
                  rspackConfig.mode = 'development';
                  rspackConfig.lazyCompilation = {
                    imports: true,
                    entries: false,
                  };
                  rspackConfig.plugins = rspackConfig.plugins || [];
                  rspackConfig.plugins.push(virtualManifestPlugin);

                  // Extract and merge sourcemaps from pre-built @rstest/core files
                  // This preserves the sourcemap chain for inline snapshot support
                  // See: https://rspack.dev/config/module-rules#rulesextractsourcemap
                  const browserRuntimeDir = dirname(browserRuntimePath);
                  rspackConfig.module = rspackConfig.module || {};
                  rspackConfig.module.rules = rspackConfig.module.rules || [];
                  rspackConfig.module.rules.unshift({
                    test: /\.js$/,
                    include: browserRuntimeDir,
                    extractSourceMap: true,
                  });

                  if (isDebug()) {
                    logger.log(
                      `[rstest:browser] extractSourceMap rule added for: ${browserRuntimeDir}`,
                    );
                  }
                },
              },
            });

            // Completely overwrite entry to prevent Rsbuild default entry detection from taking effect.
            // In browser mode, entry is fully controlled by rstest (not user's src/index.ts).
            // This must be done after mergeEnvironmentConfig to ensure highest priority.
            merged.source = merged.source || {};
            merged.source.entry = {
              runner: resolveBrowserFile('client/entry.ts'),
            };

            return merged;
          },
          // Execute after all other plugins to ensure rstest's entry config has the highest priority
          order: 'post',
        });
      },
    },
  ]);

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

          api.onAfterDevCompile(async ({ stats }) => {
            // Collect hashes even during initial build to establish baseline
            if (stats) {
              const projectEntries = await collectProjectEntries(context);
              const entryTestFiles = new Set<string>(
                collectWatchTestFiles(projectEntries).map(
                  (file) => file.testPath,
                ),
              );

              const statsJson = stats.toJson({ all: true });
              const affected = getAffectedTestFiles(
                statsJson.chunks,
                entryTestFiles,
              );
              watchContext.affectedTestFiles = affected;

              if (affected.length > 0) {
                logger.debug(
                  `[Watch] Affected test files: ${affected.join(', ')}`,
                );
              }
            }

            if (!watchContext.hooksEnabled) {
              return;
            }

            await onTriggerRerun();
          });
        },
      },
    ]);
  }

  // Register coverage plugin for browser mode
  const coverage = browserProjects.find(
    (project) => project.normalizedConfig.coverage?.enabled,
  )?.normalizedConfig.coverage;
  if (coverage?.enabled && context.command !== 'list') {
    const { pluginCoverage } = await loadCoverageProvider(
      coverage,
      context.rootPath,
    );
    rsbuildInstance.addPlugins([pluginCoverage(coverage)]);
  }

  const devServer = await rsbuildInstance.createDevServer({
    getPortSilently: true,
  });

  // Serve prebuilt container assets (SPA) via sirv
  const serveContainer = containerDistPath
    ? sirv(containerDistPath, {
        dev: false,
        single: 'index.html',
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
      html = html.replace(OPTIONS_PLACEHOLDER, serializedOptions);

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
      logger.debug(
        `[Browser UI] Failed to fetch container HTML from dev server: ${String(error)}`,
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
      logger.debug(
        `[Browser UI] Failed to proxy asset from dev server: ${String(error)}`,
      );
      return false;
    }
  };

  devServer.middlewares.use(
    async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
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
          logger.debug(`[Browser UI] Failed to open editor: ${String(error)}`);
          res.statusCode = 500;
          res.end('Failed to open editor');
        }
        return;
      }
      if (url.pathname === '/') {
        if (await respondWithDevServerHtml(url, res)) {
          return;
        }

        const html =
          injectedContainerHtml ||
          containerHtmlTemplate?.replace(OPTIONS_PLACEHOLDER, 'null');

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
    },
  );

  const { port } = await devServer.listen();

  // Create WebSocket server on an available port
  // Using port: 0 lets the OS assign an available port, avoiding conflicts
  // when the fixed port (e.g., container port + 1) is already in use
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  const wsPort = (wss.address() as AddressInfo).port;
  logger.debug(`[Browser UI] WebSocket server started on port ${wsPort}`);

  const browserName = browserLaunchOptions.browser ?? 'chromium';
  try {
    const providerImplementation = getBrowserProviderImplementation(
      browserLaunchOptions.provider,
    );
    const runtime = await providerImplementation.launchRuntime({
      browserName,
      headless: forceHeadless ?? browserLaunchOptions.headless,
    });
    return {
      rsbuildInstance,
      devServer,
      browser: runtime.browser,
      port,
      wsPort,
      manifestPath,
      tempDir,
      manifestPlugin: virtualManifestPlugin,
      setContainerOptions,
      dispatchHandlers,
      wss,
    };
  } catch (_error) {
    wss.close();
    await devServer.close();
    throw _error;
  }
};

async function resolveProjectEntries(
  context: Rstest,
  shardedEntries?: Map<string, { entries: Record<string, string> }>,
): Promise<BrowserProjectEntries[]> {
  if (shardedEntries) {
    const browserProjects = getBrowserProjects(context);
    const projectEntries: BrowserProjectEntries[] = [];
    for (const project of browserProjects) {
      const entryInfo = shardedEntries.get(project.environmentName);
      if (entryInfo && Object.keys(entryInfo.entries).length > 0) {
        const setup = getSetupFiles(
          project.normalizedConfig.setupFiles,
          project.rootPath,
        );
        projectEntries.push({
          project,
          setupFiles: Object.values(setup),
          testFiles: Object.values(entryInfo.entries),
        });
      }
    }
    return projectEntries;
  }
  return collectProjectEntries(context);
}

// ============================================================================
// Main Entry Point
// ============================================================================

export const runBrowserController = async (
  context: Rstest,
  options?: BrowserTestRunOptions,
): Promise<BrowserTestRunResult | void> => {
  const { skipOnTestRunEnd = false } = options ?? {};
  const buildStart = Date.now();
  const browserProjects = getBrowserProjects(context);
  const useHeadlessDirect = browserProjects.every(
    (project) => project.normalizedConfig.browser.headless,
  );

  const browserSourceMapCache = new Map<string, SourceMapPayload | null>();

  const isHttpLikeFile = (file: string): boolean => /^https?:\/\//.test(file);

  const resolveBrowserSourcemap = async (sourcePath: string) => {
    if (!isHttpLikeFile(sourcePath)) {
      return {
        handled: false,
        sourcemap: null,
      };
    }

    const normalizedUrl = normalizeJavaScriptUrl(sourcePath);
    if (!normalizedUrl) {
      return {
        handled: true,
        sourcemap: null,
      };
    }

    if (browserSourceMapCache.has(normalizedUrl)) {
      return {
        handled: true,
        sourcemap: browserSourceMapCache.get(normalizedUrl) ?? null,
      };
    }

    return {
      handled: true,
      sourcemap: await loadSourceMapWithCache({
        jsUrl: normalizedUrl,
        cache: browserSourceMapCache,
      }),
    };
  };

  const getBrowserSourcemap = async (
    sourcePath: string,
  ): Promise<SourceMapPayload | null> => {
    const result = await resolveBrowserSourcemap(sourcePath);
    return result.handled ? result.sourcemap : null;
  };

  /**
   * Build an error BrowserTestRunResult and call onTestRunEnd if needed.
   * Used for early-exit error paths to ensure errors reach the summary report.
   */
  const buildErrorResult = async (
    error: Error,
    close?: () => Promise<void>,
  ): Promise<BrowserTestRunResult> => {
    const elapsed = Math.max(0, Date.now() - buildStart);
    const errorResult = {
      results: [],
      testResults: [],
      duration: { totalTime: elapsed, buildTime: elapsed, testTime: 0 },
      hasFailure: true,
      unhandledErrors: [error],
      getSourcemap: getBrowserSourcemap,
      resolveSourcemap: resolveBrowserSourcemap,
      close,
    };

    if (!skipOnTestRunEnd) {
      for (const reporter of context.reporters) {
        await (reporter as Reporter).onTestRunEnd?.({
          results: [],
          testResults: [],
          duration: errorResult.duration,
          snapshotSummary: context.snapshotManager.summary,
          getSourcemap: getBrowserSourcemap,
          unhandledErrors: errorResult.unhandledErrors,
        });
      }
    }

    return errorResult;
  };

  const toError = (error: unknown): Error => {
    return error instanceof Error ? error : new Error(String(error));
  };

  const failWithError = async (
    error: unknown,
    cleanup?: () => Promise<void>,
  ): Promise<BrowserTestRunResult> => {
    ensureProcessExitCode(1);

    const normalizedError = toError(error);

    if (cleanup && skipOnTestRunEnd) {
      return buildErrorResult(normalizedError, cleanup);
    }

    try {
      return await buildErrorResult(normalizedError);
    } finally {
      await cleanup?.();
    }
  };

  const collectDeletedTestPaths = (
    previous: TestFileInfo[],
    current: TestFileInfo[],
  ): string[] => {
    const currentPathSet = new Set(current.map((file) => file.testPath));
    return previous
      .map((file) => file.testPath)
      .filter((testPath) => !currentPathSet.has(testPath));
  };

  const notifyTestRunStart = async (): Promise<void> => {
    if (skipOnTestRunEnd) {
      return;
    }

    for (const reporter of context.reporters) {
      await reporter.onTestRunStart?.();
    }
  };

  const notifyTestRunEnd = async ({
    duration,
    unhandledErrors,
    filterRerunTestPaths,
  }: {
    duration: {
      totalTime: number;
      buildTime: number;
      testTime: number;
    };
    unhandledErrors?: Error[];
    filterRerunTestPaths?: string[];
  }): Promise<void> => {
    if (skipOnTestRunEnd) {
      return;
    }

    for (const reporter of context.reporters) {
      await reporter.onTestRunEnd?.({
        results: context.reporterResults.results,
        testResults: context.reporterResults.testResults,
        duration,
        snapshotSummary: context.snapshotManager.summary,
        getSourcemap: getBrowserSourcemap,
        unhandledErrors,
        filterRerunTestPaths,
      });
    }
  };

  const containerDevServerEnv = process.env.RSTEST_CONTAINER_DEV_SERVER;
  let containerDevServer: string | undefined;
  let containerDistPath: string | undefined;

  if (!useHeadlessDirect) {
    if (containerDevServerEnv) {
      try {
        containerDevServer = new URL(containerDevServerEnv).toString();
        logger.debug(
          `[Browser UI] Using dev server for container: ${containerDevServer}`,
        );
      } catch (error) {
        const originalError = toError(error);
        originalError.message = `Invalid RSTEST_CONTAINER_DEV_SERVER value: ${originalError.message}`;
        return failWithError(originalError);
      }
    }

    if (!containerDevServer) {
      try {
        containerDistPath = resolveContainerDist();
      } catch (error) {
        return failWithError(error);
      }
    }
  }

  const projectEntries = await resolveProjectEntries(
    context,
    options?.shardedEntries,
  );
  const totalTests = projectEntries.reduce(
    (total, item) => total + item.testFiles.length,
    0,
  );

  if (totalTests === 0) {
    const code = context.normalizedConfig.passWithNoTests ? 0 : 1;
    if (!skipOnTestRunEnd) {
      const message = `No test files found, exiting with code ${code}.`;
      if (code === 0) {
        logger.log(color.yellow(message));
      } else {
        logger.error(color.red(message));
      }
    }

    if (code !== 0) {
      ensureProcessExitCode(code);
    }
    return;
  }

  await notifyTestRunStart();

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

  const manifestPath = join(tempDir, VIRTUAL_MANIFEST_FILENAME);
  const manifestSource = generateManifestModule({
    manifestPath,
    entries: projectEntries,
  });

  // Track initial test files for watch mode
  if (isWatchMode) {
    watchContext.lastTestFiles = collectWatchTestFiles(projectEntries);
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
    } catch (error) {
      return failWithError(error, async () => {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      });
    }

    if (isWatchMode) {
      watchContext.runtime = runtime;
      registerWatchCleanup();
    }
  }

  const { browser, port, wsPort, wss } = runtime;
  const buildTime = Date.now() - buildStart;

  // Collect all test files from project entries with project info
  // Normalize paths to posix format for cross-platform compatibility
  const allTestFiles: TestFileInfo[] = projectEntries.flatMap((entry) =>
    entry.testFiles.map((testPath) => ({
      testPath: normalize(testPath),
      projectName: entry.project.name,
    })),
  );

  // Only include browser mode projects in runtime configs
  // Normalize projectRoot to posix format for cross-platform compatibility
  const projectRuntimeConfigs: BrowserProjectRuntime[] = browserProjects.map(
    (project: ProjectContext) => ({
      name: project.name,
      environmentName: project.environmentName,
      projectRoot: normalize(project.rootPath),
      runtimeConfig: serializableConfig(getRuntimeConfigFromProject(project)),
      viewport: project.normalizedConfig.browser.viewport,
    }),
  );

  // Get max testTimeout from all browser projects for RPC timeout
  const maxTestTimeoutForRpc = Math.max(
    ...browserProjects.map((p) => p.normalizedConfig.testTimeout ?? 5000),
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

  const browserProviderProjects: BrowserProviderProject[] = browserProjects.map(
    (project) => ({
      rootPath: normalize(project.rootPath),
      provider: project.normalizedConfig.browser.provider,
    }),
  );
  const implementationByProvider = new Map<
    BrowserProvider,
    BrowserProviderImplementation
  >();
  for (const browserProject of browserProviderProjects) {
    if (!implementationByProvider.has(browserProject.provider)) {
      implementationByProvider.set(
        browserProject.provider,
        getBrowserProviderImplementation(browserProject.provider),
      );
    }
  }

  let activeContainerPage: BrowserProviderPage | null = null;
  let getHeadlessRunnerPageBySessionId:
    | ((sessionId: string) => BrowserProviderPage | undefined)
    | undefined;

  const dispatchBrowserRpcRequest = async ({
    request,
    target,
  }: {
    request: BrowserRpcRequest;
    target?: BrowserDispatchRequest['target'];
  }): Promise<unknown> => {
    const timeoutFallbackMs = maxTestTimeoutForRpc;
    const provider = resolveProviderForTestPath({
      testPath: request.testPath,
      browserProjects: browserProviderProjects,
    });
    const implementation = implementationByProvider.get(provider);
    if (!implementation) {
      throw new Error(`Browser provider implementation not found: ${provider}`);
    }

    const runnerPage = target?.sessionId
      ? getHeadlessRunnerPageBySessionId?.(target.sessionId)
      : undefined;

    if (target?.sessionId && !runnerPage) {
      throw new Error(
        `Runner page session not found for browser dispatch: ${target.sessionId}`,
      );
    }

    if (!runnerPage && !activeContainerPage) {
      throw new Error('Browser container page is not initialized');
    }

    try {
      return await implementation.dispatchRpc({
        containerPage: runnerPage
          ? undefined
          : (activeContainerPage ?? undefined),
        runnerPage,
        request,
        timeoutFallbackMs,
      });
    } catch (error) {
      // birpc serializes thrown Errors as `{}` over JSON; throw a string instead.
      if (error instanceof Error) {
        throw error.message;
      }
      throw String(error);
    }
  };

  runtime.dispatchHandlers.set('browser', async (dispatchRequest) => {
    const payload = dispatchRequest.args;
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid browser dispatch payload: expected object args');
    }
    return dispatchBrowserRpcRequest({
      request: payload as BrowserRpcRequest,
      target: dispatchRequest.target,
    });
  });

  runtime.setContainerOptions(hostOptions);

  // Track test results from browser runners
  const reporterResults: TestFileResult[] = [];
  const caseResults: TestResult[] = [];
  let fatalError: Error | null = null;

  const snapshotRpcMethods = {
    async resolveSnapshotPath(testPath: string): Promise<string> {
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
    async readSnapshotFile(filepath: string): Promise<string | null> {
      try {
        return await fs.readFile(filepath, 'utf-8');
      } catch {
        return null;
      }
    },
    async saveSnapshotFile(filepath: string, content: string): Promise<void> {
      const dir = dirname(filepath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filepath, content, 'utf-8');
    },
    async removeSnapshotFile(filepath: string): Promise<void> {
      try {
        await fs.unlink(filepath);
      } catch {
        // ignore if file doesn't exist
      }
    },
  };

  const handleTestFileStart = async (
    payload: TestFileStartPayload,
  ): Promise<void> => {
    await Promise.all(
      context.reporters.map((reporter) =>
        (reporter as Reporter).onTestFileStart?.({
          testPath: payload.testPath,
          tests: [],
        }),
      ),
    );
  };

  const handleTestFileReady = async (
    payload: TestFileReadyPayload,
  ): Promise<void> => {
    await Promise.all(
      context.reporters.map((reporter) =>
        (reporter as Reporter).onTestFileReady?.(payload),
      ),
    );
  };

  const handleTestSuiteStart = async (
    payload: TestSuiteStartPayload,
  ): Promise<void> => {
    await Promise.all(
      context.reporters.map((reporter) =>
        (reporter as Reporter).onTestSuiteStart?.(payload),
      ),
    );
  };

  const handleTestSuiteResult = async (
    payload: TestSuiteResultPayload,
  ): Promise<void> => {
    await Promise.all(
      context.reporters.map((reporter) =>
        (reporter as Reporter).onTestSuiteResult?.(payload),
      ),
    );
  };

  const handleTestCaseStart = async (
    payload: TestCaseStartPayload,
  ): Promise<void> => {
    await Promise.all(
      context.reporters.map((reporter) =>
        (reporter as Reporter).onTestCaseStart?.(payload),
      ),
    );
  };

  const handleTestCaseResult = async (payload: TestResult): Promise<void> => {
    caseResults.push(payload);
    await Promise.all(
      context.reporters.map((reporter) =>
        (reporter as Reporter).onTestCaseResult?.(payload),
      ),
    );
  };

  const handleTestFileComplete = async (
    payload: TestFileResult,
  ): Promise<void> => {
    reporterResults.push(payload);
    context.updateReporterResultState([payload], payload.results);
    if (payload.snapshotResult) {
      context.snapshotManager.add(payload.snapshotResult);
    }
    await Promise.all(
      context.reporters.map((reporter) =>
        (reporter as Reporter).onTestFileResult?.(payload),
      ),
    );
    if (payload.status === 'fail') {
      ensureProcessExitCode(1);
    }
  };

  const handleLog = async (payload: LogPayload): Promise<void> => {
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
  };

  const handleFatal = async (payload: FatalPayload): Promise<void> => {
    const error = new Error(payload.message);
    error.stack = payload.stack;
    fatalError = error;
    ensureProcessExitCode(1);
  };

  const runSnapshotRpc = async (
    request: SnapshotRpcRequest,
  ): Promise<unknown> => {
    switch (request.method) {
      case 'resolveSnapshotPath':
        return snapshotRpcMethods.resolveSnapshotPath(request.args.testPath);
      case 'readSnapshotFile':
        return snapshotRpcMethods.readSnapshotFile(request.args.filepath);
      case 'saveSnapshotFile':
        return snapshotRpcMethods.saveSnapshotFile(
          request.args.filepath,
          request.args.content,
        );
      case 'removeSnapshotFile':
        return snapshotRpcMethods.removeSnapshotFile(request.args.filepath);
      default:
        return undefined;
    }
  };

  const createDispatchRouter = (options?: HostDispatchRouterOptions) => {
    return createHostDispatchRouter({
      routerOptions: options,
      runnerCallbacks: {
        onTestFileStart: handleTestFileStart,
        onTestFileReady: handleTestFileReady,
        onTestSuiteStart: handleTestSuiteStart,
        onTestSuiteResult: handleTestSuiteResult,
        onTestCaseStart: handleTestCaseStart,
        onTestCaseResult: handleTestCaseResult,
        onTestFileComplete: handleTestFileComplete,
        onLog: handleLog,
        onFatal: handleFatal,
      },
      runSnapshotRpc,
      extensionHandlers: runtime.dispatchHandlers,
      onDuplicateNamespace: (namespace) => {
        logger.debug(
          `[Dispatch] Skip registering dispatch namespace "${namespace}" because it is already reserved`,
        );
      },
    });
  };

  if (useHeadlessDirect) {
    // Session-based scheduling path: lifecycle + session index + dispatch routing.
    type ActiveHeadlessRun = RunSession & {
      contexts: Set<BrowserProviderContext>;
    };

    const viewportByProject = mapViewportByProject(projectRuntimeConfigs);
    const runLifecycle = new RunSessionLifecycle<ActiveHeadlessRun>();
    const sessionRegistry = new RunnerSessionRegistry();
    getHeadlessRunnerPageBySessionId = (sessionId) => {
      return sessionRegistry.getById(sessionId)?.page;
    };
    let dispatchRequestCounter = 0;

    const nextDispatchRequestId = (namespace: string): string => {
      return `${namespace}-${++dispatchRequestCounter}`;
    };

    const closeContextSafely = async (
      browserContext: BrowserProviderContext,
    ): Promise<void> => {
      try {
        await browserContext.close();
      } catch {
        // ignore
      }
    };

    const cancelRun = async (
      run: ActiveHeadlessRun,
      waitForDone = true,
    ): Promise<void> => {
      await runLifecycle.cancel(run, {
        waitForDone,
        onCancel: async (session) => {
          await Promise.all(
            Array.from(session.contexts).map((browserContext) =>
              closeContextSafely(browserContext),
            ),
          );
        },
      });
    };

    const dispatchRouter = createDispatchRouter({
      isRunTokenStale: (runToken) => runLifecycle.isTokenStale(runToken),
      onStale: (request) => {
        if (request.namespace === 'runner') {
          logger.debug(
            `[Headless] Dropped stale message "${request.method}" for ${request.target?.testFile ?? 'unknown'}`,
          );
        }
      },
    });

    const dispatchRunnerMessage = async (
      run: ActiveHeadlessRun,
      file: TestFileInfo,
      sessionId: string,
      message: BrowserClientMessage,
    ): Promise<void> => {
      const response = await dispatchRouter.dispatch({
        requestId: nextDispatchRequestId('runner'),
        runToken: run.token,
        namespace: 'runner',
        method: message.type,
        args: 'payload' in message ? message.payload : undefined,
        target: {
          sessionId,
          testFile: file.testPath,
          projectName: file.projectName,
        },
      });

      if (response.stale) {
        return;
      }

      if (response.error) {
        throw new Error(response.error);
      }
    };

    const runSingleFile = async (
      run: ActiveHeadlessRun,
      file: TestFileInfo,
    ): Promise<void> => {
      if (run.cancelled || runLifecycle.isTokenStale(run.token)) {
        return;
      }

      const viewport = viewportByProject.get(file.projectName);
      const browserContext = await browser.newContext({
        viewport: viewport ?? null,
      });
      run.contexts.add(browserContext);

      let page: BrowserProviderPage | null = null;
      let sessionId: string | null = null;
      let settled = false;
      let resolveDone: (() => void) | null = null;

      const markDone = (): void => {
        if (!settled) {
          settled = true;
          resolveDone?.();
        }
      };

      const donePromise = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });

      const projectRuntime = projectRuntimeConfigs.find(
        (project) => project.name === file.projectName,
      );
      const perFileTimeoutMs =
        (projectRuntime?.runtimeConfig.testTimeout ?? maxTestTimeoutForRpc) +
        30_000;

      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      try {
        page = await browserContext.newPage();

        const session = sessionRegistry.register({
          testFile: file.testPath,
          projectName: file.projectName,
          runToken: run.token,
          mode: 'headless-page',
          context: browserContext,
          page,
        });
        sessionId = session.id;

        await attachHeadlessRunnerTransport(page, {
          onDispatchMessage: async (message) => {
            try {
              await dispatchRunnerMessage(run, file, session.id, message);
              if (
                message.type === 'file-complete' ||
                message.type === 'complete'
              ) {
                markDone();
              } else if (message.type === 'fatal') {
                markDone();
                await cancelRun(run, false);
              }
            } catch (error) {
              const formatted = toError(error);
              await handleFatal({
                message: formatted.message,
                stack: formatted.stack,
              });
              markDone();
              await cancelRun(run, false);
            }
          },
          onDispatchRpc: async (request) => {
            return dispatchRouter.dispatch({
              ...request,
              runToken: run.token,
              target: {
                sessionId: session.id,
                testFile: file.testPath,
                projectName: file.projectName,
                ...request.target,
              },
            });
          },
        });

        const inlineOptions: BrowserHostConfig = {
          ...hostOptions,
          testFile: file.testPath,
          runId: `${run.token}:${session.id}`,
        };
        const serializedOptions = serializeForInlineScript(inlineOptions);
        await page.addInitScript(
          `window.__RSTEST_BROWSER_OPTIONS__ = ${serializedOptions};`,
        );

        await page.goto(`http://localhost:${port}/runner.html`, {
          waitUntil: 'load',
        });

        const timeoutPromise = new Promise<'timeout'>((resolve) => {
          timeoutId = setTimeout(() => resolve('timeout'), perFileTimeoutMs);
        });

        const state = await Promise.race([
          donePromise.then(() => 'done' as const),
          timeoutPromise,
          run.cancelSignal.then(() => 'cancelled' as const),
        ]);

        if (state === 'cancelled') {
          return;
        }

        if (
          state === 'timeout' &&
          runLifecycle.isTokenActive(run.token) &&
          !run.cancelled
        ) {
          await handleFatal({
            message: `Test execution timeout after ${perFileTimeoutMs / 1000}s for ${file.testPath}.`,
          });
          await cancelRun(run, false);
        }
      } catch (error) {
        if (runLifecycle.isTokenActive(run.token) && !run.cancelled) {
          const formatted = toError(error);
          await handleFatal({
            message: formatted.message,
            stack: formatted.stack,
          });
          await cancelRun(run, false);
        }
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (page) {
          try {
            await page.close();
          } catch {
            // ignore
          }
        }
        if (sessionId) {
          sessionRegistry.deleteById(sessionId);
        }
        run.contexts.delete(browserContext);
        await closeContextSafely(browserContext);
      }
    };

    const runFilesWithPool = async (files: TestFileInfo[]): Promise<void> => {
      if (files.length === 0) {
        return;
      }

      const previous = runLifecycle.activeSession;
      if (previous) {
        await cancelRun(previous);
      }

      const run = runLifecycle.createSession((token) => ({
        ...createRunSession(token),
        contexts: new Set<BrowserProviderContext>(),
      }));

      const queue = [...files];
      const concurrency = getHeadlessConcurrency(context, queue.length);

      const worker = async (): Promise<void> => {
        while (
          queue.length > 0 &&
          !run.cancelled &&
          runLifecycle.isTokenActive(run.token)
        ) {
          const next = queue.shift();
          if (!next) {
            return;
          }
          await runSingleFile(run, next);
        }
      };

      run.done = Promise.all(
        Array.from(
          { length: Math.min(queue.length, Math.max(concurrency, 1)) },
          () => worker(),
        ),
      ).then(() => {});

      await run.done;
      runLifecycle.clearIfActive(run);
    };

    const latestRerunScheduler = createHeadlessLatestRerunScheduler<
      TestFileInfo,
      ActiveHeadlessRun
    >({
      getActiveRun: () => runLifecycle.activeSession,
      isRunCancelled: (run) => run.cancelled,
      invalidateActiveRun: () => {
        runLifecycle.invalidateActiveToken();
      },
      interruptActiveRun: async (run) => {
        await cancelRun(run, false);
      },
      runFiles: async (files) => {
        await notifyTestRunStart();

        const rerunStartTime = Date.now();
        const fatalErrorBeforeRun = fatalError;
        let rerunError: Error | undefined;

        try {
          await runFilesWithPool(files);
        } catch (error) {
          rerunError = toError(error);
          throw error;
        } finally {
          const testTime = Math.max(0, Date.now() - rerunStartTime);
          const rerunFatalError =
            fatalError && fatalError !== fatalErrorBeforeRun
              ? fatalError
              : undefined;
          await notifyTestRunEnd({
            duration: {
              totalTime: testTime,
              buildTime: 0,
              testTime,
            },
            filterRerunTestPaths: files.map((file) => file.testPath),
            unhandledErrors: rerunError
              ? [rerunError]
              : rerunFatalError
                ? [rerunFatalError]
                : undefined,
          });
        }
      },
      onError: async (error) => {
        const formatted = toError(error);
        await handleFatal({
          message: formatted.message,
          stack: formatted.stack,
        });
      },
      onInterrupt: (run) => {
        logger.debug(
          `[Headless] Interrupting active run token ${run.token} before scheduling latest rerun`,
        );
      },
    });

    const testStart = Date.now();
    await runFilesWithPool(allTestFiles);
    const testTime = Date.now() - testStart;

    if (isWatchMode) {
      triggerRerun = async () => {
        const newProjectEntries = await collectProjectEntries(context);
        const rerunPlan = planWatchRerun({
          projectEntries: newProjectEntries,
          previousTestFiles: watchContext.lastTestFiles,
          affectedTestFiles: watchContext.affectedTestFiles,
        });
        watchContext.affectedTestFiles = [];

        if (rerunPlan.filesChanged) {
          const deletedTestPaths = collectDeletedTestPaths(
            watchContext.lastTestFiles,
            rerunPlan.currentTestFiles,
          );
          if (deletedTestPaths.length > 0) {
            context.updateReporterResultState([], [], deletedTestPaths);
          }
          watchContext.lastTestFiles = rerunPlan.currentTestFiles;
          if (rerunPlan.currentTestFiles.length === 0) {
            await latestRerunScheduler.enqueueLatest([]);
            logger.log(
              color.cyan('No browser test files remain after update.\n'),
            );
            return;
          }

          logger.log(
            color.cyan(
              `Test file set changed, re-running ${rerunPlan.currentTestFiles.length} file(s)...\n`,
            ),
          );
          void latestRerunScheduler.enqueueLatest(rerunPlan.currentTestFiles);
          return;
        }

        if (rerunPlan.affectedTestFiles.length === 0) {
          logger.log(
            color.cyan(
              'No affected browser test files detected, skipping re-run.\n',
            ),
          );
          return;
        }

        logger.log(
          color.cyan(
            `Re-running ${rerunPlan.affectedTestFiles.length} affected test file(s)...\n`,
          ),
        );
        void latestRerunScheduler.enqueueLatest(rerunPlan.affectedTestFiles);
      };
    }

    const closeHeadlessRuntime = !isWatchMode
      ? async () => {
          sessionRegistry.clear();
          await destroyBrowserRuntime(runtime);
        }
      : undefined;

    if (fatalError) {
      return failWithError(fatalError, closeHeadlessRuntime);
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

    const result = {
      results: reporterResults,
      testResults: caseResults,
      duration,
      hasFailure: isFailure,
      getSourcemap: getBrowserSourcemap,
      resolveSourcemap: resolveBrowserSourcemap,
      close: skipOnTestRunEnd ? closeHeadlessRuntime : undefined,
    };

    if (!skipOnTestRunEnd) {
      try {
        await notifyTestRunEnd({ duration });
      } finally {
        await closeHeadlessRuntime?.();
      }
    }

    if (isWatchMode && triggerRerun) {
      watchContext.hooksEnabled = true;
      logger.log(
        color.cyan(
          '\nWatch mode enabled - will re-run tests on file changes\n',
        ),
      );
    }

    return result;
  }

  let completedTests = 0;

  // Promise that resolves when all tests complete
  let resolveAllTests: (() => void) | undefined;
  const allTestsPromise = new Promise<void>((resolve) => {
    resolveAllTests = resolve;
  });

  // Open a container page for user to view (reuse in watch mode)
  let containerContext: BrowserProviderContext;
  let containerPage: BrowserProviderPage;
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
    containerPage.on('popup', async (popup: BrowserProviderPage) => {
      await popup.close().catch(() => {});
    });

    containerContext.on('page', async (page: BrowserProviderPage) => {
      if (page !== containerPage) {
        await page.close().catch(() => {});
      }
    });

    if (isWatchMode) {
      runtime.containerPage = containerPage;
      runtime.containerContext = containerContext;
    }

    // Forward browser console to terminal
    containerPage.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('[Container]') || text.startsWith('[Runner]')) {
        logger.log(color.gray(`[Browser Console] ${text}`));
      }
    });
  }

  activeContainerPage = containerPage;

  const dispatchRouter = createDispatchRouter();

  // Create RPC methods that can access test state variables
  const createRpcMethods = (): HostRpcMethods => ({
    async rerunTest(testFile: string, testNamePattern?: string) {
      const projectName = context.normalizedConfig.name || 'project';
      const relativePath = relative(context.rootPath, testFile);
      const displayPath = `<${projectName}>/${relativePath}`;
      logger.log(
        color.cyan(
          `\nRe-running test: ${displayPath}${testNamePattern ? ` (pattern: ${testNamePattern})` : ''}\n`,
        ),
      );
      await rpcManager.reloadTestFile(testFile, testNamePattern);
    },
    async getTestFiles() {
      return allTestFiles;
    },
    async onTestFileStart(payload: TestFileStartPayload) {
      await handleTestFileStart(payload);
    },
    async onTestCaseResult(payload: TestResult) {
      await handleTestCaseResult(payload);
    },
    async onTestFileComplete(payload: TestFileResult) {
      await handleTestFileComplete(payload);

      completedTests++;
      if (completedTests >= allTestFiles.length && resolveAllTests) {
        resolveAllTests();
      }
    },
    async onLog(payload: LogPayload) {
      await handleLog(payload);
    },
    async onFatal(payload: FatalPayload) {
      await handleFatal(payload);
      if (resolveAllTests) {
        resolveAllTests();
      }
    },
    async dispatch(request: BrowserDispatchRequest) {
      // Headed/container path now shares the same dispatch contract as headless.
      return dispatchRouter.dispatch(request);
    },
  });

  // Setup RPC manager
  let rpcManager: ContainerRpcManager;

  if (isWatchMode && runtime.rpcManager) {
    rpcManager = runtime.rpcManager;
    // Update methods with new test state (caseResults, completedTests, etc.)
    rpcManager.updateMethods(createRpcMethods());
    // Reattach if we have an existing WebSocket
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

  // Only navigate on first creation
  if (isNewPage) {
    const pagePath = '/';
    await containerPage.goto(`http://localhost:${port}${pagePath}`, {
      waitUntil: 'load',
    });

    logger.log(
      color.cyan(
        `\nBrowser mode opened at http://localhost:${port}${pagePath}\n`,
      ),
    );
  }

  // Wait for all tests to complete
  // Calculate total timeout based on config: max testTimeout * file count + buffer
  const maxTestTimeout = Math.max(
    ...browserProjects.map((p) => p.normalizedConfig.testTimeout ?? 5000),
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
      const rerunPlan = planWatchRerun({
        projectEntries: newProjectEntries,
        previousTestFiles: watchContext.lastTestFiles,
        affectedTestFiles: watchContext.affectedTestFiles,
      });
      watchContext.affectedTestFiles = [];

      if (rerunPlan.filesChanged) {
        const deletedTestPaths = collectDeletedTestPaths(
          watchContext.lastTestFiles,
          rerunPlan.currentTestFiles,
        );
        if (deletedTestPaths.length > 0) {
          context.updateReporterResultState([], [], deletedTestPaths);
        }
        watchContext.lastTestFiles = rerunPlan.currentTestFiles;
        await rpcManager.notifyTestFileUpdate(rerunPlan.currentTestFiles);
      }

      if (rerunPlan.normalizedAffectedTestFiles.length > 0) {
        logger.log(
          color.cyan(
            `Re-running ${rerunPlan.normalizedAffectedTestFiles.length} affected test file(s)...\n`,
          ),
        );
        await notifyTestRunStart();

        const rerunStartTime = Date.now();
        const fatalErrorBeforeRun = fatalError;
        let rerunError: Error | undefined;

        try {
          for (const testFile of rerunPlan.normalizedAffectedTestFiles) {
            await rpcManager.reloadTestFile(testFile);
          }
        } catch (error) {
          rerunError = toError(error);
          throw error;
        } finally {
          const testTime = Math.max(0, Date.now() - rerunStartTime);
          const rerunFatalError =
            fatalError && fatalError !== fatalErrorBeforeRun
              ? fatalError
              : undefined;
          await notifyTestRunEnd({
            duration: {
              totalTime: testTime,
              buildTime: 0,
              testTime,
            },
            filterRerunTestPaths: rerunPlan.normalizedAffectedTestFiles,
            unhandledErrors: rerunError
              ? [rerunError]
              : rerunFatalError
                ? [rerunFatalError]
                : undefined,
          });
        }
      } else if (!rerunPlan.filesChanged) {
        logger.log(color.cyan('Tests will be re-executed automatically\n'));
      }
    };
  }

  const closeContainerRuntime = !isWatchMode
    ? async () => {
        try {
          await containerPage.close();
        } catch {
          // ignore
        }
        try {
          await containerContext.close();
        } catch {
          // ignore
        }
        await destroyBrowserRuntime(runtime);
      }
    : undefined;

  if (fatalError) {
    return failWithError(fatalError, closeContainerRuntime);
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

  const result = {
    results: reporterResults,
    testResults: caseResults,
    duration,
    hasFailure: isFailure,
    getSourcemap: getBrowserSourcemap,
    resolveSourcemap: resolveBrowserSourcemap,
    close: skipOnTestRunEnd ? closeContainerRuntime : undefined,
  };

  if (!skipOnTestRunEnd) {
    try {
      await notifyTestRunEnd({ duration });
    } finally {
      await closeContainerRuntime?.();
    }
  }

  // Enable watch hooks AFTER initial test run to avoid duplicate runs
  if (isWatchMode && triggerRerun) {
    watchContext.hooksEnabled = true;
    logger.log(
      color.cyan('\nWatch mode enabled - will re-run tests on file changes\n'),
    );
  }

  return result;
};

// ============================================================================
// List Browser Tests
// ============================================================================

/**
 * Result from collecting browser tests.
 * This is the return type for listBrowserTests, designed for future extraction
 * to a separate browser package.
 */
export type ListBrowserTestsResult = {
  list: ListCommandResult[];
  close: () => Promise<void>;
};

/**
 * Collect test metadata from browser mode projects without running them.
 * This function creates a headless browser runtime, loads test files,
 * and collects their test structure (describe/test declarations).
 */
export const listBrowserTests = async (
  context: Rstest,
  options?: {
    shardedEntries?: Map<string, { entries: Record<string, string> }>;
  },
): Promise<ListBrowserTestsResult> => {
  const projectEntries = await resolveProjectEntries(
    context,
    options?.shardedEntries,
  );
  const totalTests = projectEntries.reduce(
    (total, item) => total + item.testFiles.length,
    0,
  );

  if (totalTests === 0) {
    return {
      list: [],
      close: async () => {},
    };
  }

  const tempDir = join(
    context.rootPath,
    TEMP_RSTEST_OUTPUT_DIR,
    'browser',
    `list-${Date.now()}`,
  );

  const manifestPath = join(tempDir, VIRTUAL_MANIFEST_FILENAME);
  const manifestSource = generateManifestModule({
    manifestPath,
    entries: projectEntries,
  });
  const browserProjects = getBrowserProjects(context);

  // Create a simplified browser runtime for collect mode
  let runtime: BrowserRuntime;
  try {
    runtime = await createBrowserRuntime({
      context,
      manifestPath,
      manifestSource,
      tempDir,
      isWatchMode: false,
      containerDistPath: undefined,
      containerDevServer: undefined,
      forceHeadless: true, // Always use headless for list command
    });
  } catch (error) {
    const providers = [
      ...new Set(
        browserProjects.map((p) => p.normalizedConfig.browser.provider),
      ),
    ];
    logger.error(
      color.red(
        `Failed to initialize browser provider runtime (${providers.join(', ')}).`,
      ),
      error,
    );
    throw error;
  }

  const { browser, port } = runtime;

  // Get browser projects for runtime config
  // Normalize projectRoot to posix format for cross-platform compatibility
  const projectRuntimeConfigs: BrowserProjectRuntime[] = browserProjects.map(
    (project: ProjectContext) => ({
      name: project.name,
      environmentName: project.environmentName,
      projectRoot: normalize(project.rootPath),
      runtimeConfig: serializableConfig(getRuntimeConfigFromProject(project)),
      viewport: project.normalizedConfig.browser.viewport,
    }),
  );

  // Get max testTimeout from all browser projects for RPC timeout
  const maxTestTimeoutForRpc = Math.max(
    ...browserProjects.map((p) => p.normalizedConfig.testTimeout ?? 5000),
  );

  const hostOptions: BrowserHostConfig = {
    rootPath: normalize(context.rootPath),
    projects: projectRuntimeConfigs,
    snapshot: {
      updateSnapshot: context.snapshotManager.options.updateSnapshot,
    },
    mode: 'collect', // Use collect mode
    debug: isDebug(),
    rpcTimeout: maxTestTimeoutForRpc,
  };

  runtime.setContainerOptions(hostOptions);

  // Collect results
  const collectResults: ListCommandResult[] = [];
  let fatalError: Error | null = null;
  let collectCompleted = false;

  // Promise that resolves when collection is complete
  let resolveCollect: (() => void) | undefined;
  const collectPromise = new Promise<void>((resolve) => {
    resolveCollect = resolve;
  });

  // Create a headless page to run collection
  const browserContext = await browser.newContext({ viewport: null });
  const page = await browserContext.newPage();

  // Expose dispatch function for browser client to send messages
  await page.exposeFunction(
    '__rstest_dispatch__',
    (message: { type: string; payload?: unknown }) => {
      switch (message.type) {
        case 'collect-result': {
          const payload = message.payload as {
            testPath: string;
            project: string;
            tests: Test[];
          };
          collectResults.push({
            testPath: payload.testPath,
            project: payload.project,
            tests: payload.tests,
          });
          break;
        }
        case 'collect-complete':
          collectCompleted = true;
          resolveCollect?.();
          break;
        case 'fatal': {
          const payload = message.payload as {
            message: string;
            stack?: string;
          };
          fatalError = new Error(payload.message);
          fatalError.stack = payload.stack;
          resolveCollect?.();
          break;
        }
        case 'ready':
        case 'log':
          // Ignore these messages during collection
          break;
        default:
          // Log unexpected messages for debugging
          logger.debug(`[List] Unexpected message: ${message.type}`);
      }
    },
  );

  // Inject host options before navigation so the runner can access them
  const serializedOptions = serializeForInlineScript(hostOptions);
  await page.addInitScript(
    `window.__RSTEST_BROWSER_OPTIONS__ = ${serializedOptions};`,
  );

  // Navigate to runner page
  await page.goto(`http://localhost:${port}/runner.html`, {
    waitUntil: 'load',
  });

  // Wait for collection to complete with timeout
  const timeoutMs = 30000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      if (!collectCompleted) {
        logger.warn(
          color.yellow(
            `[List] Browser test collection timed out after ${timeoutMs}ms`,
          ),
        );
      }
      resolve();
    }, timeoutMs);
  });

  await Promise.race([collectPromise, timeoutPromise]);

  // Clear timeout to prevent Node.js from waiting for it
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  // Cleanup
  const cleanup = async () => {
    try {
      await page.close();
      await browserContext.close();
    } catch {
      // ignore
    }
    await destroyBrowserRuntime(runtime);
  };

  if (fatalError) {
    await cleanup();
    // Return error in the result format instead of throwing
    const errorResult: ListCommandResult = {
      testPath: '',
      project: '',
      tests: [],
      errors: [
        {
          name: 'BrowserCollectError',
          message: (fatalError as Error).message,
          stack: (fatalError as Error).stack,
        } as FormattedError,
      ],
    };
    return {
      list: [errorResult],
      close: async () => {},
    };
  }

  return {
    list: collectResults,
    close: cleanup,
  };
};
