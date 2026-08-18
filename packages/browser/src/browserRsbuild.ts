import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { Rspack } from '@rstest/core';
import {
  applyWatchInvalidation,
  applyWebMockRspackConfig,
  color,
  type EntryHashSnapshot,
  getSetupFiles,
  getTestEntries,
  initModifyRstestConfigHooks,
  isDebug,
  logger,
  loadCoverageProvider,
  pluginMockRuntime,
  type ProjectContext,
  resolveProjectBuildCache,
  resolveShardedEntries,
  RSTEST_ENV_SYMBOL_KEY,
  type RstestContext,
  rsbuild,
  type WatchInvalidationState,
} from '@rstest/core/internal/browser';
import openEditor from 'open-editor';
import { dirname, join, normalize, relative, resolve } from 'pathe';
import picomatch from 'picomatch';
import sirv from 'sirv';
import { WebSocketServer } from 'ws';
import { validateBrowserConfig } from './configValidation';
import type { ContainerRpcManager } from './containerRpc';
import type { HeadedRunRegistry } from './headedRunRegistry';
import {
  type BrowserDispatchHandler,
  type BrowserHostConfig,
  type BrowserProjectRuntime,
  type BrowserViewport,
  RSTEST_BROWSER_CACHE_CLEANERS_KEY,
  type TestFileInfo,
} from './protocol';
import type {
  BrowserProvider,
  BrowserProviderBrowser,
  BrowserProviderContext,
  BrowserProviderPage,
} from './providers';
import { getBrowserProviderImplementation } from './providers';
import { resolveBrowserViewportPreset } from './viewportPresets';
import { collectWatchTestFiles } from './watchRerunPlanner';

const { createRsbuild, rspack } = rsbuild;
type RsbuildDevServer = rsbuild.RsbuildDevServer;
type RsbuildInstance = rsbuild.RsbuildInstance;
type RsbuildEnvironmentConfig = rsbuild.EnvironmentConfig &
  Pick<rsbuild.RsbuildConfig, 'root'>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIONS_PLACEHOLDER = '__RSTEST_OPTIONS_PLACEHOLDER__';

export const serializeForInlineScript = (value: unknown): string => {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
};

// ============================================================================
// Type Definitions

type BrowserProjectEntries = {
  project: ProjectContext;
  setupFiles: string[];
  testFiles: string[];
};

class RstestBrowserRuntimePlugin {
  apply(compiler: Rspack.Compiler) {
    const { RuntimeModule } = compiler.webpack;
    class BrowserRuntimeModule extends RuntimeModule {
      constructor() {
        super('rstest_browser_runtime');
      }

      override generate() {
        return `
var __rstest_browser_test_entry_ids__ = Object.create(null);

__webpack_require__.rstest_register_browser_test_entry = (path, id) => {
  __rstest_browser_test_entry_ids__[path] = id;
};

function __rstest_clean_browser_test_entry__(testEntryPath) {
  var testEntryId = __rstest_browser_test_entry_ids__[testEntryPath];
  if (testEntryId !== undefined) {
    delete __webpack_module_cache__[testEntryId];
  }
}

(globalThis[${JSON.stringify(RSTEST_BROWSER_CACHE_CLEANERS_KEY)}] ??= new Set()).add(__rstest_clean_browser_test_entry__);
`;
      }
    }

    compiler.hooks.thisCompilation.tap(
      'RstestBrowserRuntimePlugin',
      (compilation) => {
        compilation.hooks.additionalTreeRuntimeRequirements.tap(
          'RstestAddBrowserRuntimePlugin',
          (chunk) => {
            compilation.addRuntimeModule(chunk, new BrowserRuntimeModule());
          },
        );
      },
    );
  }
}

export type BrowserProviderProject = {
  rootPath: string;
  provider: BrowserProvider;
};

type BrowserLaunchOptions = {
  provider: BrowserProvider;
  browser: ProjectContext['normalizedConfig']['browser']['browser'];
  headless: ProjectContext['normalizedConfig']['browser']['headless'];
  port: ProjectContext['normalizedConfig']['browser']['port'];
  strictPort: ProjectContext['normalizedConfig']['browser']['strictPort'];
  providerOptions: Record<string, unknown>;
};

const getBrowserProviderOptions = (
  project: ProjectContext,
): Record<string, unknown> => {
  const browserConfig = project.normalizedConfig.browser as {
    providerOptions?: Record<string, unknown>;
  };

  return browserConfig.providerOptions ?? {};
};

export type BrowserProjectServer = {
  projectName: string;
  environmentName: string;
  rsbuildInstance: RsbuildInstance;
  devServer: RsbuildDevServer;
  port: number;
  manifestPath: string;
};

// Watch diff/rerun state. Lives on the BrowserRuntime (one per set of
// per-project compilers, surviving controller re-entry that reuses the
// runtime) instead of module scope, so its lifetime always matches the
// compilers whose baselines it holds.
type BrowserWatchState = {
  lastTestFiles: TestFileInfo[];
  hooksEnabled: boolean;
  /**
   * The rerun trigger of the CURRENT controller entry. The watch plugins below
   * live as long as the compilers (one runtime, many controller entries after
   * config-change restarts), so they must not capture any one entry's trigger:
   * a closure bound at runtime creation would keep driving the first entry's
   * dead scheduler forever, and watch would silently stop rerunning.
   */
  triggerRerun?: () => Promise<void>;
  /**
   * The headed run registry (identity + settlement owner). Lives here so a
   * re-entering controller adopts the previous entry's still-open runs
   * instead of orphaning them in a discarded closure.
   */
  headedRuns?: HeadedRunRegistry;
  /**
   * The committed file set's monotonic version. Lives here for the same reason
   * the registry does: the frame set it versions is the container's, and the
   * container outlives any one controller entry. A per-entry counter would
   * restart at 1 and become indistinguishable from the previous entry's
   * in-flight acks — the exact ABA the version replaced a content signature to
   * avoid.
   */
  headedFileSetVersion: number;
  // Diff baselines keyed per project: sibling projects have isolated
  // compilers, so a shared flat baseline would let one project's compile
  // clobber another's (missed reruns) and collide on compiler-local chunk
  // keys.
  invalidation: Map<string, WatchInvalidationState>;
  // Affected files accumulated per project until a rerun drains them, so a
  // compile finishing while another project's rerun is being planned cannot
  // drop pending work.
  pendingAffectedTestFiles: Map<string, Set<string>>;
  // Per-project compile start times and the accumulated compile duration of
  // the pending rerun, so the rerun's finalize reports the real buildTime.
  compileStartTimes: Map<string, number>;
  pendingBuildTimeMs: number;
};

const createBrowserWatchState = (): BrowserWatchState => ({
  lastTestFiles: [],
  hooksEnabled: false,
  headedFileSetVersion: 1,
  invalidation: new Map(),
  pendingAffectedTestFiles: new Map(),
  compileStartTimes: new Map(),
  pendingBuildTimeMs: 0,
});

export const drainPendingBuildTime = (
  watchState: BrowserWatchState,
): number => {
  const buildTime = watchState.pendingBuildTimeMs;
  watchState.pendingBuildTimeMs = 0;
  return buildTime;
};

export const drainPendingAffectedTestFiles = (
  watchState: BrowserWatchState,
): string[] => {
  const affected = new Set<string>();
  for (const files of watchState.pendingAffectedTestFiles.values()) {
    for (const file of files) {
      affected.add(file);
    }
  }
  watchState.pendingAffectedTestFiles.clear();
  return Array.from(affected);
};

export type BrowserRuntime = {
  // Per-project servers, keyed by project name.
  projectServers: Map<string, BrowserProjectServer>;
  // The server that hosts the container UI HTML (headed mode). The WebSocket
  // server below is shared and reachable from any origin.
  containerServer: BrowserProjectServer;
  browser: BrowserProviderBrowser;
  browserLaunchOptions: BrowserLaunchOptions;
  wsPort: number;
  tempDir: string;
  containerPage?: BrowserProviderPage;
  containerContext?: BrowserProviderContext;
  setContainerOptions: (options: BrowserHostConfig) => void;
  // Reserved extension seam for host-side dispatch capabilities.
  dispatchHandlers: Map<string, BrowserDispatchHandler>;
  wss: WebSocketServer;
  rpcManager?: ContainerRpcManager;
  projectEntries: BrowserProjectEntries[];
  watchState: BrowserWatchState;
};

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

export const mapViewportByProject = (
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

const castArray = <T>(arr?: T | T[]): T[] => {
  if (arr === undefined) {
    return [];
  }
  return Array.isArray(arr) ? arr : [arr];
};

const applyDefaultWatchOptions = (
  rspackConfig: Rspack.Configuration,
  isWatchMode: boolean,
) => {
  rspackConfig.watchOptions ??= {};

  if (!isWatchMode) {
    rspackConfig.watchOptions.ignored = '**/**';
    return;
  }

  rspackConfig.watchOptions.ignored = castArray(
    rspackConfig.watchOptions.ignored || [],
  ) as string[];

  if (rspackConfig.watchOptions.ignored.length === 0) {
    rspackConfig.watchOptions.ignored.push('**/.git', '**/node_modules');
  }

  if (rspackConfig.output?.path) {
    rspackConfig.watchOptions.ignored.push(rspackConfig.output.path);
  }
};

type LazyCompilationModule = {
  nameForCondition?: () => string | null | undefined;
};

type BrowserLazyCompilationConfig = {
  imports: true;
  entries: false;
  test?: (module: LazyCompilationModule) => boolean;
};

/**
 * Resolve the actual port the dev server is listening on.
 *
 * Rsbuild's `devServer.listen()` may return `0` when configured with
 * `server.port: 0` because its internal `getPort` never reads back the
 * OS-assigned ephemeral port.  This helper falls back to
 * `httpServer.address()` to obtain the real bound port.
 */
const resolveListenPort = (
  listenPort: number,
  httpServer: {
    address: () => ReturnType<import('node:net').Server['address']>;
  } | null,
): number => {
  if (listenPort) {
    return listenPort;
  }
  const addr = httpServer?.address();
  if (addr && typeof addr === 'object') {
    return addr.port;
  }
  return listenPort;
};

const createBrowserLazyCompilationConfig = (
  setupFiles: string[],
): BrowserLazyCompilationConfig => {
  const eagerSetupFiles = new Set(
    setupFiles.map((filePath) => normalize(filePath)),
  );

  if (eagerSetupFiles.size === 0) {
    return {
      imports: true,
      entries: false,
    };
  }

  return {
    imports: true,
    entries: false,
    test(module: LazyCompilationModule) {
      const filePath = module.nameForCondition?.();
      return !filePath || !eagerSetupFiles.has(normalize(filePath));
    },
  };
};

/**
 * HMR — and the lazyCompilation transport it carries — is wired only for headed
 * watch, the sole path that reuses a persistent page and applies module updates
 * in place. Headless always loads each test file in a fresh page (pulling the
 * latest incrementally-built chunks over HTTP), and one-shot runs never rerun,
 * so pushing HMR updates there is dead weight that only races factory
 * registration for chunk-split node_modules (rspack#11922) and lets
 * lazyCompilation's accept-chain walk abort the next spec when no boundary
 * exists (#1472). Disabling HMR does not make watch rebuilds any less
 * incremental — HMR is only the client push transport.
 */
const shouldEnableBrowserHmr = (
  isWatchMode: boolean,
  isHeadless: boolean,
): boolean => isWatchMode && !isHeadless;

const createBrowserRsbuildDevConfig = (
  enableHmr: boolean,
): {
  writeToDisk: boolean;
  hmr: boolean;
  client: {
    logLevel: 'error';
  };
} => {
  return {
    writeToDisk: isDebug(),
    // `enableHmr` is gated to headed watch by `shouldEnableBrowserHmr` — the one
    // path that reuses a page. See that helper for why fresh-page runs (headless,
    // or any one-shot) must not receive HMR pushes.
    hmr: enableHmr,
    client: {
      logLevel: 'error' as const,
    },
  };
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
    dot: true,
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

const REGEXP_SPECIAL_CHARACTERS = /[|\\{}()[\]^$+*?.]/g;
const PATH_SEPARATOR_SOURCE = String.raw`[\\/]`;
const WINDOWS_ABSOLUTE_PATH_SOURCE = String.raw`[A-Za-z]:[\\/]`;

const escapeRegExp = (value: string): string =>
  value.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&');

const normalizePathForRegExp = (value: string): string =>
  normalize(value).replaceAll('\\', '/');

const normalizeExcludePatternForRegExp = (value: string): string =>
  value.startsWith('./')
    ? `./${normalizePathForRegExp(value.substring(2))}`
    : normalizePathForRegExp(value);

const isAbsolutePatternForRegExp = (value: string): boolean =>
  value.startsWith('/') || /^[A-Za-z]:\//.test(value);

const isEscapedRegExpCharacter = (source: string, index: number): boolean => {
  let backslashCount = 0;
  for (
    let current = index - 1;
    current >= 0 && source[current] === '\\';
    current--
  ) {
    backslashCount++;
  }
  return backslashCount % 2 === 1;
};

const replacePathSeparatorsInRegExpSource = (source: string): string => {
  let result = '';
  let inCharacterClass = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    const isEscaped = isEscapedRegExpCharacter(source, index);

    if (character === '[' && !isEscaped) {
      inCharacterClass = true;
    }

    if (!inCharacterClass && character === '\\' && source[index + 1] === '/') {
      result += PATH_SEPARATOR_SOURCE;
      index++;
      continue;
    }

    result += character;

    if (character === ']' && !isEscaped) {
      inCharacterClass = false;
    }
  }

  return result;
};

type BrowserContextExcludeSource = {
  relative: string;
  absolute: string;
  isAbsolute: boolean;
};

const createRelativeContextExcludeSource = (
  source: string,
  normalizedPattern: string,
): string => {
  if (normalizedPattern.startsWith('./')) {
    return source;
  }

  return normalizedPattern.startsWith('**/')
    ? `(?:(?:${source})|\\.(?:${source}))`
    : `(?:(?:${source})|\\.${PATH_SEPARATOR_SOURCE}(?:${source}))`;
};

const createProjectAbsoluteExcludeSource = (
  source: string,
  normalizedPattern: string,
): string =>
  normalizedPattern.startsWith('./') || normalizedPattern.startsWith('**/')
    ? source
    : `${PATH_SEPARATOR_SOURCE}(?:${source})`;

/**
 * Convert exclude patterns to a RegExp for import.meta.webpackContext's exclude option
 * This is used at compile time to filter out files during bundling
 *
 * Example:
 *   Input: ['**\/node_modules\/**', '**\/dist\/**']
 *   Output: a regexp matching node_modules or dist path segments.
 */
const excludePatternsToRegExpSources = (
  patterns: string[],
): BrowserContextExcludeSource[] | null => {
  const sources = patterns.map((pattern) => {
    const normalizedPattern = normalizeExcludePatternForRegExp(pattern);
    const regex = globToRegexp(normalizedPattern);
    let source = regex.source;
    if (source.startsWith('^')) {
      source = source.substring(1);
    }
    if (source.endsWith('$')) {
      source = source.substring(0, source.length - 1);
    }

    source = replacePathSeparatorsInRegExpSource(source);
    const isAbsolute = isAbsolutePatternForRegExp(normalizedPattern);
    const absolute = normalizedPattern.startsWith('./')
      ? source.substring(2)
      : source;

    return {
      relative: isAbsolute
        ? source
        : createRelativeContextExcludeSource(source, normalizedPattern),
      absolute: isAbsolute
        ? absolute
        : createProjectAbsoluteExcludeSource(absolute, normalizedPattern),
      isAbsolute,
    };
  });

  if (sources.length === 0) {
    return null;
  }

  return sources;
};

export const createBrowserContextExcludeRegExp = (
  patterns: string[],
  projectRoot: string,
): RegExp | null => {
  const excludeSources = excludePatternsToRegExpSources(patterns);
  if (!excludeSources) {
    return null;
  }

  const normalizedProjectRoot = normalizePathForRegExp(projectRoot).replace(
    /[\\/]$/,
    '',
  );
  const projectRootSource = normalizedProjectRoot
    .split('/')
    .map(escapeRegExp)
    .join(PATH_SEPARATOR_SOURCE);
  const relativeExcludeSources = excludeSources.filter(
    (source) => !source.isAbsolute,
  );
  const absoluteExcludeSources = excludeSources.filter(
    (source) => source.isAbsolute,
  );
  const sourceBranches: string[] = [];

  if (relativeExcludeSources.length > 0) {
    const relativePatternSource = `(?:${relativeExcludeSources
      .map((source) => source.relative)
      .join('|')})`;
    const absolutePatternSource = `(?:${relativeExcludeSources
      .map((source) => source.absolute)
      .join('|')})`;
    const relativeSource = `(?:${relativePatternSource})`;
    const absoluteSource = normalizedProjectRoot
      ? `${projectRootSource}(?=${PATH_SEPARATOR_SOURCE})(?:${absolutePatternSource})`
      : `(?:${absolutePatternSource})`;

    sourceBranches.push(
      `(?!${WINDOWS_ABSOLUTE_PATH_SOURCE}|${PATH_SEPARATOR_SOURCE})${relativeSource}`,
      absoluteSource,
    );
  }

  if (absoluteExcludeSources.length > 0) {
    sourceBranches.push(
      `(?:${absoluteExcludeSources
        .map((source) => source.relative)
        .join('|')})`,
    );
  }

  return new RegExp(`^(?:${sourceBranches.join('|')})$`);
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
 * Fold one project compile's chunks into per-entry hash snapshots and apply
 * the shared watch-invalidation policy against that project's baseline.
 * Chunks are attributed to a test/setup file by scanning their modules; the
 * chunk.id/names key is only the hash-record key, never a cross-project one.
 */
const getAffectedTestFiles = ({
  chunks,
  entryTestFiles,
  setupFiles,
  state,
}: {
  chunks: StatsChunk[] | undefined;
  entryTestFiles: Set<string>;
  setupFiles: Set<string>;
  state: WatchInvalidationState;
}): string[] => {
  const entryHashes: EntryHashSnapshot = new Map();
  const setupHashes: EntryHashSnapshot = new Map();

  const recordChunk = (
    snapshot: EntryHashSnapshot,
    entryPath: string,
    chunkKey: string,
    hash: string,
  ) => {
    const record = snapshot.get(entryPath) ?? {};
    record[chunkKey] = hash;
    snapshot.set(entryPath, record);
  };

  for (const chunk of chunks || []) {
    if (!chunk.hash) continue;

    const chunkKey = getChunkKey(chunk);
    if (!chunkKey) continue;

    const testFile = findTestFileInModules(chunk.modules, entryTestFiles);
    if (testFile) {
      recordChunk(entryHashes, testFile, chunkKey, chunk.hash);
      continue;
    }

    const setupFile = findTestFileInModules(chunk.modules, setupFiles);
    if (setupFile) {
      recordChunk(setupHashes, setupFile, chunkKey, chunk.hash);
    }
  }

  // Headed watch compiles chunks on demand (lazyCompilation), so an entry's
  // first appearance in stats means "just loaded", not "just added": its first
  // sighting establishes the baseline instead of marking a change. Genuinely
  // new and deleted test files are owned by `planWatchRerun`'s file-set diff.
  const seedFirstSeen = (
    baseline: EntryHashSnapshot | undefined,
    current: EntryHashSnapshot,
  ) => {
    if (!baseline) return;
    for (const [entryPath, record] of current) {
      if (!baseline.has(entryPath)) {
        baseline.set(entryPath, record);
      }
    }
  };
  seedFirstSeen(state.entryHashes, entryHashes);
  seedFirstSeen(state.setupHashes, setupHashes);

  const outcome = applyWatchInvalidation(state, { entryHashes, setupHashes });

  if (outcome.rerunAll) {
    logger.debug(
      '[Watch] Setup file changed, re-running all test files of the project',
    );
    return Array.from(entryTestFiles);
  }

  for (const affected of outcome.affectedPaths) {
    logger.debug(`[Watch] Chunk hash changed for test: ${affected}`);
  }

  return outcome.affectedPaths;
};

export const getBrowserProjects = (context: RstestContext): ProjectContext[] =>
  context.projects.filter(
    (project) => project.normalizedConfig.browser.enabled,
  );

const getBrowserRsbuildEnvironmentConfig = (
  project: ProjectContext,
): RsbuildEnvironmentConfig => ({
  plugins: project.normalizedConfig.plugins,
  root: project.rootPath,
});

// Max testTimeout across browser projects, used for provider assertion fallback
// and browser server fetch timeout.

const getBrowserLaunchOptions = (
  project: ProjectContext,
): BrowserLaunchOptions => ({
  provider: project.normalizedConfig.browser.provider,
  browser: project.normalizedConfig.browser.browser,
  headless: project.normalizedConfig.browser.headless,
  port: project.normalizedConfig.browser.port,
  strictPort: project.normalizedConfig.browser.strictPort,
  providerOptions: getBrowserProviderOptions(project),
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
    // Each browser project now runs on its own rsbuild dev server, so ports may
    // differ per project. Only the shared single Playwright browser forces
    // provider/browser/headless/providerOptions to match across projects.
    if (
      options.provider !== firstOptions.provider ||
      options.browser !== firstOptions.browser ||
      options.headless !== firstOptions.headless ||
      !isDeepStrictEqual(options.providerOptions, firstOptions.providerOptions)
    ) {
      throw new Error(
        `Browser launch config mismatch between projects "${firstProject.name}" and "${project.name}". ` +
          'All browser-enabled projects in one run must share provider/browser/headless/providerOptions.',
      );
    }
  }

  return firstOptions;
};

export const collectProjectEntries = async (
  context: RstestContext,
  // The explicit browser-project subset the executor was constructed with. Falls
  // back to re-deriving from `context` for internal callers (e.g. the watch
  // plugin) that do not carry the plan's project list.
  browserProjects: ProjectContext[] = getBrowserProjects(context),
): Promise<BrowserProjectEntries[]> => {
  return Promise.all(
    browserProjects.map(async (project) => {
      const {
        normalizedConfig: { include, exclude, includeSource, setupFiles },
      } = project;

      const tests = await getTestEntries({
        include,
        exclude: exclude.patterns,
        includeSource,
        rootPath: context.rootPath,
        projectRoot: project.rootPath,
        fileFilters: context.fileFilters,
        fileFilterMode: context.fileFilterMode,
      });

      const setup = getSetupFiles(setupFiles, project.rootPath);

      return {
        project,
        setupFiles: Object.values(setup),
        testFiles: Object.values(tests),
      };
    }),
  );
};

const resolveBrowserDistFile = (relativePath: string): string => {
  const candidates = [
    resolve(__dirname, relativePath),
    resolve(__dirname, '../dist', relativePath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve browser dist file: ${relativePath}`);
};

export const resolveContainerDist = (): string => {
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

// Host-side mirror of the browser runtime's `toContextKey` (client/runner.ts):
// `./<path-relative-to-project-root>` with forward slashes. The runtime derives
// the same key from the target test file, so the non-watch import map below must
// key by the identical form for `loadTest(key)` to resolve.
export const toContextKey = (
  filePath: string,
  projectRootPosix: string,
): string => {
  const posixPath = normalize(filePath);
  // Only strip the root at a path boundary: a bare `startsWith` would mangle a
  // sibling like `/repo/pkg-extra/a.test.ts` under root `/repo/pkg`.
  const withinRoot =
    posixPath === projectRootPosix ||
    posixPath.startsWith(`${projectRootPosix}/`);
  if (!withinRoot) {
    // Test file outside the project root: use the absolute path as the key so
    // the runtime `toAbsolutePath` can round-trip it. A `./`-prefixed relative
    // key would be re-rooted under projectRoot and point at a nonexistent file.
    return posixPath;
  }
  const rel = posixPath.slice(projectRootPosix.length);
  return rel.startsWith('/') ? `.${rel}` : `./${rel}`;
};

const generateManifestModule = ({
  manifestPath,
  entries,
  isWatchMode,
}: {
  manifestPath: string;
  entries: BrowserProjectEntries[];
  isWatchMode: boolean;
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

  // 3. Test context for each project. Both branches expose the same shape as a
  // webpackContext (callable by key, plus `keys()`), consumed in section 4.
  lines.push('// Test context for each project');
  for (const { project, testFiles } of entries) {
    const varName = `context_${toSafeVarName(project.environmentName)}`;
    const projectRootPosix = normalize(project.rootPath);

    if (isWatchMode) {
      // Watch mode keeps the include-glob context so newly added files are
      // picked up on rebuild via `keys()` without regenerating the manifest.
      // `mode: 'lazy'` is plain code-splitting (async chunks over HTTP), so it
      // works with or without lazyCompilation; headed watch additionally layers
      // lazyCompilation on top to keep the initial build cheap.
      const includeRegExp = globPatternsToRegExp(
        project.normalizedConfig.include,
      );
      const excludeRegExp = createBrowserContextExcludeRegExp(
        project.normalizedConfig.exclude.patterns,
        projectRootPosix,
      );
      const { includeSource } = project.normalizedConfig;
      const emitContext = (contextVarName: string, regExp: RegExp): void => {
        lines.push(
          `const ${contextVarName} = import.meta.webpackContext(${JSON.stringify(projectRootPosix)}, {`,
        );
        lines.push('  recursive: true,');
        lines.push(`  regExp: ${regExp.toString()},`);
        if (excludeRegExp) {
          lines.push(`  exclude: ${excludeRegExp.toString()},`);
        }
        lines.push("  mode: 'lazy',");
        lines.push('});');
      };

      if (includeSource.length === 0) {
        emitContext(varName, includeRegExp);
      } else {
        // In-source test files (`includeSource`) carry an
        // `if (import.meta.rstest)` block. The include context can't see them,
        // so a second context over the `includeSource` globs backs
        // host-scheduled loads, while `keys()` only unions the entry-probed
        // in-source files (the probe does not apply inside the bundle, so raw
        // source-context keys would execute never-probed files and fail with
        // "No test suites found"). The probed list can go stale until a
        // manifest refresh; scheduled-by-path loading never does.
        emitContext(`${varName}_include`, includeRegExp);
        emitContext(`${varName}_source`, globPatternsToRegExp(includeSource));
        const probedKeys = testFiles.map((filePath) =>
          toContextKey(filePath, projectRootPosix),
        );
        lines.push(`const ${varName}_probed = ${JSON.stringify(probedKeys)};`);
        lines.push(
          `const ${varName}_includeKeys = new Set(${varName}_include.keys());`,
        );
        lines.push(`const ${varName} = Object.assign(`);
        lines.push(
          `  (key) => ${varName}_includeKeys.has(key) ? ${varName}_include(key) : ${varName}_source(key),`,
        );
        lines.push('  {');
        lines.push(
          `    keys: () => Array.from(new Set([...${varName}_includeKeys, ...${varName}_probed])),`,
        );
        lines.push('  },');
        lines.push(');');
      }
    } else {
      // One-shot runs: the file set is fixed and already filtered, so emit an
      // explicit lazy-import map (one chunk per literal `import()`, like the
      // setup loaders above). The eager, non-lazyCompilation build then compiles
      // only the run set instead of every included test file.
      lines.push(`const ${varName}_modules = {`);
      for (const filePath of testFiles) {
        const key = toContextKey(filePath, projectRootPosix);
        const importPath = toRelativeImport(filePath);
        lines.push(
          `  ${JSON.stringify(key)}: () => import(${JSON.stringify(importPath)}),`,
        );
      }
      lines.push('};');
      lines.push(
        `const ${varName} = Object.assign((key) => ${varName}_modules[key](), {`,
      );
      lines.push(`  keys: () => Object.keys(${varName}_modules),`);
      lines.push('});');
    }
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

const closeAllProjectServers = (
  servers: Iterable<BrowserProjectServer>,
): Promise<unknown> =>
  Promise.allSettled([...servers].map((server) => server.devServer.close()));

// Copy a proxied fetch Response's status + headers onto the Node response,
// dropping content-length (the body is re-sent, so the original length may not
// match).
const copyProxyResponseHeaders = (
  response: Response,
  res: ServerResponse,
): void => {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-length') {
      return;
    }
    res.setHeader(key, value);
  });
};

export const destroyBrowserRuntime = async (
  runtime: BrowserRuntime,
): Promise<void> => {
  try {
    await runtime.browser?.close?.();
  } catch {
    // ignore
  }
  await closeAllProjectServers(runtime.projectServers.values());
  try {
    runtime.wss?.close();
  } catch {
    // ignore
  }
  await fs
    .rm(runtime.tempDir, { recursive: true, force: true })
    .catch(() => {});
};

export const createBrowserRuntime = async ({
  context,
  projectEntries: initialProjectEntries,
  browserProjects,
  shardedEntries,
  freezeShardedEntries,
  tempDir,
  isWatchMode,
  containerDistPath,
  containerDevServer,
  forceHeadless,
  skipProviderLaunch,
  appliedModifyRstestConfigEnvironments,
}: {
  context: RstestContext;
  projectEntries: BrowserProjectEntries[];
  /**
   * The explicit browser-project subset (plan output). Drives launch-option
   * consistency and the container origin (`browserProjects[0]`).
   */
  browserProjects: ProjectContext[];
  shardedEntries?: Map<string, { entries: Record<string, string> }>;
  freezeShardedEntries?: boolean;
  tempDir: string;
  isWatchMode: boolean;
  containerDistPath?: string;
  containerDevServer?: string;
  /** Force headless mode regardless of user config (used for list command) */
  forceHeadless?: boolean;
  skipProviderLaunch?: boolean;
  appliedModifyRstestConfigEnvironments?: Set<string>;
}): Promise<BrowserRuntime> => {
  // ---- Shared singletons (created once, wired into every project server) ----
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

  let browserLaunchOptions =
    ensureConsistentBrowserLaunchOptions(browserProjects);
  let projectEntries = initialProjectEntries;
  // Created with the runtime so the per-project watch plugins and the
  // controller's rerun closures share one state whose lifetime matches the
  // compilers holding the diffed chunks.
  const watchState = createBrowserWatchState();
  const manifestModules: Array<{
    manifestPath: string;
    project: ProjectContext;
    modules: Record<string, string>;
  }> = [];

  const createRuntimeWithoutProvider = (): BrowserRuntime => {
    const firstProject = browserProjects[0]!;
    return {
      projectServers: new Map(),
      containerServer: {
        projectName: firstProject.name,
        environmentName: firstProject.environmentName,
        rsbuildInstance: undefined as unknown as RsbuildInstance,
        devServer: {
          close: async () => undefined,
        } as RsbuildDevServer,
        port: 0,
        manifestPath: '',
      },
      browser: undefined as unknown as BrowserProviderBrowser,
      browserLaunchOptions,
      wsPort: 0,
      tempDir,
      setContainerOptions,
      dispatchHandlers,
      wss: undefined as unknown as WebSocketServer,
      projectEntries,
      watchState,
    };
  };

  const getProjectEntry = (project: ProjectContext) =>
    projectEntries.find(
      (item) => item.project.environmentName === project.environmentName,
    );

  const refreshManifestModule = (manifestModule: {
    manifestPath: string;
    project: ProjectContext;
    modules: Record<string, string>;
  }): void => {
    const entry = getProjectEntry(manifestModule.project);
    manifestModule.modules[manifestModule.manifestPath] =
      generateManifestModule({
        manifestPath: manifestModule.manifestPath,
        entries: [
          {
            project: manifestModule.project,
            testFiles: entry?.testFiles ?? [],
            setupFiles: entry?.setupFiles ?? [],
          },
        ],
        isWatchMode,
      });
  };

  const refreshProjectEntries = async (): Promise<void> => {
    validateBrowserConfig(context);
    browserLaunchOptions =
      ensureConsistentBrowserLaunchOptions(browserProjects);
    const updatedShardedEntries = freezeShardedEntries
      ? shardedEntries
      : context.normalizedConfig.shard
        ? await resolveShardedEntries(context)
        : shardedEntries;
    projectEntries = await resolveProjectEntries(
      context,
      updatedShardedEntries,
      browserProjects,
    );
    for (const manifestModule of manifestModules) {
      refreshManifestModule(manifestModule);
    }
  };

  // Rstest internal aliases that must not be overridden by user config
  const browserRuntimePath = fileURLToPath(
    import.meta.resolve('@rstest/core/internal/browser-runtime'),
  );

  // Shared by every project — only the per-project virtual manifest
  // alias varies (one virtual manifest per server).
  const staticRstestAliases = {
    // User test code `import { describe, it } from '@rstest/core'` is NOT
    // aliased: `applyWebMockRspackConfig` keeps the request external against
    // `globalThis['@rstest/core']` (node parity), which also keeps the mock
    // hoister's provider-import ordering correct for `rs.hoisted` callbacks.
    // User test code: import { page } from '@rstest/browser'
    '@rstest/browser': resolveBrowserDistFile('client/index.js'),
    // Browser runner runtime APIs
    // Uses dist file with extractSourceMap to preserve sourcemap chain for inline snapshots
    '@rstest/core/internal/browser-runtime': browserRuntimePath,
  };

  // rspack `define` replaces `process.env` / `import.meta.env` with this literal
  // expression. JSON.stringify reproduces the exact double-quoted `"rstest.env"`
  // text, so the owned key can never drift from the runtime
  // `Symbol.for(RSTEST_ENV_SYMBOL_KEY)` sites.
  const rstestEnvDefine = `globalThis[Symbol.for(${JSON.stringify(
    RSTEST_ENV_SYMBOL_KEY,
  )})]`;

  // Serve prebuilt container assets (SPA) via sirv (container origin only)
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

      copyProxyResponseHeaders(response, res);
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
      copyProxyResponseHeaders(response, res);
      res.end(buffer);
      return true;
    } catch (error) {
      logger.debug(
        `[Browser UI] Failed to proxy asset from dev server: ${String(error)}`,
      );
      return false;
    }
  };

  const serveContainerRoute = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): Promise<void> => {
    if (!req.url) {
      next();
      return;
    }

    const url = new URL(req.url, 'http://localhost');
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

    next();
  };

  // ---- Build one isolated rsbuild instance + dev server per project ----
  const buildProjectServer = async (
    project: ProjectContext,
    isContainerServer: boolean,
  ): Promise<BrowserProjectServer> => {
    const manifestPath = join(
      tempDir,
      toSafeVarName(project.environmentName),
      VIRTUAL_MANIFEST_FILENAME,
    );
    const entry = getProjectEntry(project);
    const virtualManifestModules = {
      [manifestPath]: generateManifestModule({
        manifestPath,
        entries: [
          {
            project,
            testFiles: entry?.testFiles ?? [],
            setupFiles: entry?.setupFiles ?? [],
          },
        ],
        isWatchMode,
      }),
    };
    const virtualManifestPlugin = new rspack.experiments.VirtualModulesPlugin(
      virtualManifestModules,
    );
    manifestModules.push({
      manifestPath,
      project,
      modules: virtualManifestModules,
    });

    const rstestInternalAliases = {
      __rstest_virtual_browser_manifest__: manifestPath,
      ...staticRstestAliases,
    };

    const isHeadless =
      forceHeadless || project.normalizedConfig.browser.headless;
    const enableHmr = shouldEnableBrowserHmr(isWatchMode, isHeadless);

    const rsbuildInstance = await createRsbuild({
      callerName: 'rstest',
      rsbuildConfig: {
        root: context.rootPath,
        mode: 'development',
        server: {
          printUrls: false,
          // Each project gets its own dev server. Honor an explicitly
          // configured port; otherwise keep the historical 4000 default for the
          // container server and let the OS assign free ports for the rest, so
          // multiple projects never collide on one port.
          port:
            project.normalizedConfig.browser.port ??
            (isContainerServer ? 4000 : 0),
          strictPort: project.normalizedConfig.browser.strictPort,
          // User plugins may emit index.html; register before Rsbuild's HTML
          // completion middleware so `/` remains owned by the Browser UI.
          setup: isContainerServer
            ? ({ server }) => {
                server.middlewares.use(serveContainerRoute);
              }
            : undefined,
        },
        dev: createBrowserRsbuildDevConfig(enableHmr),
        environments: {
          [project.environmentName]:
            getBrowserRsbuildEnvironmentConfig(project),
        },
      },
    });

    initModifyRstestConfigHooks(
      context,
      rsbuildInstance,
      [project],
      [project],
      {
        getEnvironmentConfig: getBrowserRsbuildEnvironmentConfig,
        onModifyRstestConfigApplied: refreshProjectEntries,
        appliedEnvironmentNames: appliedModifyRstestConfigEnvironments,
      },
    );

    // Add plugin to merge user Rsbuild config with rstest required config
    rsbuildInstance.addPlugins([
      // Same mock runtime as the node build (importActual doppelganger rule +
      // mock webpack runtime module); order-insensitive and self-contained.
      pluginMockRuntime,
      {
        name: 'rstest:browser-user-config',
        setup(api) {
          if (context.command === 'list') {
            let testEntryPaths: Set<string> | undefined;
            const getTestEntryPaths = () =>
              (testEntryPaths ??= new Set(
                getProjectEntry(project)?.testFiles.map(normalize) ?? [],
              ));

            api.transform(
              {
                test: (resourcePath) =>
                  getTestEntryPaths().has(normalize(resourcePath)),
              },
              ({ code, resourcePath }) => ({
                code: `${code}\nif (__webpack_require__.rstest_register_browser_test_entry && __webpack_module__.id != null) {
  __webpack_require__.rstest_register_browser_test_entry(${JSON.stringify(normalize(resourcePath))}, __webpack_module__.id);
}`,
              }),
            );
          }

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
              if (name !== project.environmentName) {
                return config;
              }

              const userRsbuildConfig = project.normalizedConfig;
              const buildCache = resolveProjectBuildCache({
                context,
                project,
              });
              const setupFiles = Object.values(
                getSetupFiles(
                  project.normalizedConfig.setupFiles,
                  project.rootPath,
                ),
              );
              // Merge order: current config -> userConfig -> rstest required config (highest priority)
              const merged = mergeEnvironmentConfig(
                config,
                {
                  ...userRsbuildConfig,
                  performance: buildCache
                    ? {
                        ...userRsbuildConfig.performance,
                        buildCache,
                      }
                    : userRsbuildConfig.performance,
                },
                {
                  resolve: {
                    alias: rstestInternalAliases,
                  },
                  source: {
                    define: {
                      'process.env': rstestEnvDefine,
                      'import.meta.env': rstestEnvDefine,
                    },
                  },
                  output: {
                    target: 'web',
                    // Enable source map for inline snapshot support
                    sourceMap: {
                      js: 'source-map',
                    },
                    // Every project server compiles the same asset names
                    // (`static/js/runner.js`, ...). With `dev.writeToDisk`
                    // (debug mode) the middleware serves from disk, so a
                    // shared dist dir would be last-writer-wins and one
                    // project's server would deliver another project's
                    // bundle — keep each project's output isolated, inside
                    // the run's temp dir so teardown removes it.
                    distPath: {
                      root: join(
                        tempDir,
                        'server',
                        toSafeVarName(project.environmentName),
                      ),
                    },
                  },
                  tools: {
                    swc: (swcConfig) => {
                      // Fixture dependency discovery reads callback parameters
                      // through Function#toString(). Playwright's supported
                      // browsers all support parameter destructuring, so keep
                      // that syntax intact in the browser test bundle.
                      swcConfig.env ??= {};
                      swcConfig.env.exclude = Array.from(
                        new Set([
                          ...(swcConfig.env.exclude ?? []),
                          'transform-parameters',
                        ]),
                      );
                    },
                    rspack: (rspackConfig) => {
                      rspackConfig.mode = 'development';
                      // Web parameterization of the node mock transform:
                      // RstestPlugin (hoist + path injection), the
                      // `@rstest/core` global external, and
                      // `exportsPresence: 'warn'`.
                      applyWebMockRspackConfig(rspackConfig, {
                        rspack,
                        rootPath: project.rootPath,
                      });
                      // lazyCompilation's only delivery transport is the HMR
                      // runtime, so it follows the same gate as HMR (see
                      // `shouldEnableBrowserHmr`): headed watch only, everything
                      // else compiles eagerly.
                      rspackConfig.lazyCompilation = enableHmr
                        ? createBrowserLazyCompilationConfig(setupFiles)
                        : false;
                      rspackConfig.plugins = rspackConfig.plugins || [];
                      rspackConfig.plugins.push(
                        new RstestBrowserRuntimePlugin(),
                      );
                      rspackConfig.plugins.push(virtualManifestPlugin);

                      applyDefaultWatchOptions(rspackConfig, isWatchMode);

                      // Extract and merge sourcemaps from pre-built @rstest/core files
                      // This preserves the sourcemap chain for inline snapshot support
                      // See: https://rspack.rs/config/module-rules#rulesextractsourcemap
                      const browserRuntimeDir = dirname(browserRuntimePath);
                      rspackConfig.module = rspackConfig.module || {};
                      rspackConfig.module.rules =
                        rspackConfig.module.rules || [];
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
                },
              );

              // Completely overwrite entry to prevent Rsbuild default entry detection from taking effect.
              // In browser mode, entry is fully controlled by rstest (not user's src/index.ts).
              // This must be done after mergeEnvironmentConfig to ensure highest priority.
              merged.source = merged.source || {};
              merged.source.entry = {
                runner: resolveBrowserDistFile('client/runner.js'),
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
    if (isWatchMode) {
      rsbuildInstance.addPlugins([
        {
          name: 'rstest:browser-watch',
          setup(api) {
            api.onBeforeDevCompile(() => {
              watchState.compileStartTimes.set(project.name, Date.now());
              if (!watchState.hooksEnabled) {
                return;
              }
              logger.log(color.cyan('\nFile changed, re-running tests...\n'));
            });

            api.onAfterDevCompile(async ({ stats }) => {
              const compileStart = watchState.compileStartTimes.get(
                project.name,
              );
              if (compileStart !== undefined) {
                watchState.compileStartTimes.delete(project.name);
                // Only change-triggered compiles feed the pending rerun's
                // build phase (the initial build is the initial run's
                // buildTime). Parallel project compiles overlap; the longest
                // one bounds the rerun's build phase.
                if (watchState.hooksEnabled) {
                  watchState.pendingBuildTimeMs = Math.max(
                    watchState.pendingBuildTimeMs,
                    Date.now() - compileStart,
                  );
                }
              }
              // Collect hashes even during initial build to establish baseline
              if (stats) {
                // This compiler only ever holds this project's entries; the
                // diff baseline is keyed per project accordingly.
                const [projectEntry] = await collectProjectEntries(context, [
                  project,
                ]);
                const entryTestFiles = new Set<string>(
                  collectWatchTestFiles(projectEntry ? [projectEntry] : []).map(
                    (file) => file.testPath,
                  ),
                );
                const setupFiles = new Set<string>(
                  (projectEntry?.setupFiles ?? []).map((file) =>
                    normalize(file),
                  ),
                );

                let state = watchState.invalidation.get(project.name);
                if (!state) {
                  state = {};
                  watchState.invalidation.set(project.name, state);
                }

                const statsJson = stats.toJson({ all: true });
                const affected = getAffectedTestFiles({
                  chunks: statsJson.chunks,
                  entryTestFiles,
                  setupFiles,
                  state,
                });

                if (affected.length > 0) {
                  const pending =
                    watchState.pendingAffectedTestFiles.get(project.name) ??
                    new Set<string>();
                  for (const file of affected) {
                    pending.add(file);
                  }
                  watchState.pendingAffectedTestFiles.set(
                    project.name,
                    pending,
                  );
                  logger.debug(
                    `[Watch] Affected test files: ${affected.join(', ')}`,
                  );
                }
              }

              if (!watchState.hooksEnabled) {
                return;
              }

              // Late-bound through the watch state: this plugin outlives the
              // controller entry that created it (config-change restarts reuse
              // the runtime), so it must drive the CURRENT entry's trigger,
              // never one captured at runtime creation.
              await watchState.triggerRerun?.();
            });
          },
        },
      ]);
    }

    if (skipProviderLaunch) {
      await rsbuildInstance.initConfigs({ action: 'dev' });
      return {
        projectName: project.name,
        environmentName: project.environmentName,
        rsbuildInstance,
        devServer: {
          close: async () => undefined,
        } as RsbuildDevServer,
        port: 0,
        manifestPath,
      };
    }

    // Register coverage plugin if this project enables coverage
    const coverage = project.normalizedConfig.coverage;
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

    if (isDebug()) {
      await rsbuildInstance.inspectConfig({
        writeToDisk: true,
        // The server's own distPath is isolated per project inside the run's
        // temp dir (removed at teardown); keep the debug artifacts at the
        // project's stable dist root so they survive the run and stay where
        // the docs point users to.
        outputPath: resolve(
          context.rootPath,
          context.normalizedConfig.output.distPath.root,
          '.rsbuild',
        ),
        extraConfigs: {
          rstest: {
            ...context.normalizedConfig,
            projects: [project.normalizedConfig],
          },
        },
      });
    }

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
            logger.debug(
              `[Browser UI] Failed to open editor: ${String(error)}`,
            );
            res.statusCode = 500;
            res.end('Failed to open editor');
          }
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

    const { port: listenPort } = await devServer.listen();
    const port = resolveListenPort(listenPort, devServer.httpServer);

    return {
      projectName: project.name,
      environmentName: project.environmentName,
      rsbuildInstance,
      devServer,
      port,
      manifestPath,
    };
  };

  // Build each project's server sequentially. Servers must bind ports one at a
  // time: projects may share a configured port and rely on strictPort:false
  // bumping to the next free one, which races under concurrent listen().
  const projectServers = new Map<string, BrowserProjectServer>();
  try {
    for (const [index, project] of browserProjects.entries()) {
      const server = await buildProjectServer(project, index === 0);
      projectServers.set(server.projectName, server);
    }
  } catch (error) {
    await closeAllProjectServers(projectServers.values());
    throw error;
  }

  if (skipProviderLaunch) {
    return createRuntimeWithoutProvider();
  }

  // browserProjects is non-empty (ensureConsistentBrowserLaunchOptions throws
  // otherwise) and index 0 is the designated container origin.
  const containerServer = projectServers.get(browserProjects[0]!.name)!;

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
      providerOptions: browserLaunchOptions.providerOptions,
    });
    return {
      projectServers,
      containerServer,
      browser: runtime.browser,
      browserLaunchOptions,
      wsPort,
      tempDir,
      setContainerOptions,
      dispatchHandlers,
      wss,
      projectEntries,
      watchState,
    };
  } catch (error) {
    wss.close();
    await closeAllProjectServers(projectServers.values());
    throw error;
  }
};

export async function resolveProjectEntries(
  context: RstestContext,
  shardedEntries: Map<string, { entries: Record<string, string> }> | undefined,
  browserProjects: ProjectContext[],
): Promise<BrowserProjectEntries[]> {
  if (shardedEntries) {
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
  return collectProjectEntries(context, browserProjects);
}
