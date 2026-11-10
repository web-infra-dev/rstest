import {
  browserIgnoredRuntimeConfigKeys,
  color,
  type InternalContext,
  getReportedProjects,
  logger,
  resolveBrowserInstances,
  type RuntimeConfig,
} from '@rstest/core/internal/browser';
import type { BrowserName } from './protocol';
import { resolveBrowserViewportPreset } from './viewportPresets';

type BrowserProjectConfig =
  InternalContext['projects'][number]['normalizedConfig'];

/**
 * Per-key warning for a browser-ignored RuntimeConfig field, keyed by the exact
 * RuntimeConfig keys the `executorCapabilities` table marks 'ignored-warn' /
 * 'stripped'. {@link reportUnsupportedBrowserOptions} iterates the table's
 * {@link browserIgnoredRuntimeConfigKeys} and looks each key up here, so the
 * warnings are genuinely table-driven.
 */
const ignoredKeyWarnings: Partial<
  Record<
    keyof RuntimeConfig,
    {
      /** True when the project's value is non-default (worth warning about). */
      isNonDefault: (config: BrowserProjectConfig) => boolean;
      message: (config: BrowserProjectConfig) => string;
      /**
       * Warn only on browser-only runs. Global-only config (copied onto every
       * project) that a mixed repo may legitimately set for its node projects.
       */
      browserOnly?: boolean;
    }
  >
> = {
  testEnvironment: {
    isNonDefault: (config) => config.testEnvironment.name !== 'node',
    message: (config) =>
      `Ignoring testEnvironment '${config.testEnvironment.name}' in browser ` +
      'mode: the browser itself is the test environment.',
  },
  detectAsyncLeaks: {
    isNonDefault: (config) => config.detectAsyncLeaks === true,
    message: () =>
      'Ignoring detectAsyncLeaks in browser mode: it relies on node ' +
      'async_hooks.',
  },
  logHeapUsage: {
    isNonDefault: (config) => config.logHeapUsage === true,
    message: () => 'Ignoring logHeapUsage in browser mode.',
  },
};

/**
 * Browser-ignored keys handled outside the generic warn loop: `coverage` is
 * 'stripped' but gets the dedicated provider check in
 * {@link reportUnsupportedBrowserOptions} (a V8 hard error for browser-only
 * non-Chromium runs, a warning in mixed runs), not a plain "set → warn".
 */
const speciallyHandledIgnoredKeys: (keyof RuntimeConfig)[] = ['coverage'];

/**
 * Every browser-ignored RuntimeConfig key this module checks — the union of the
 * warn descriptors and the specially-handled keys. Exported for the lockstep
 * test that asserts it covers {@link browserIgnoredRuntimeConfigKeys}.
 */
export const browserValidatedIgnoredKeys: (keyof RuntimeConfig)[] = [
  ...(Object.keys(ignoredKeyWarnings) as (keyof RuntimeConfig)[]),
  ...speciallyHandledIgnoredKeys,
];

// Anti-#1389 lockstep (runs at module load): fail loudly if the
// `executorCapabilities` table gains an 'ignored-warn' / 'stripped' browser key
// that this validation does not cover, instead of it becoming a silent no-op.
const assertIgnoredKeysCovered = (): void => {
  const covered = new Set<string>(browserValidatedIgnoredKeys);
  const uncovered = browserIgnoredRuntimeConfigKeys.filter(
    (key) => !covered.has(key),
  );
  if (uncovered.length > 0) {
    throw new Error(
      'Browser config validation is out of sync with executorCapabilities: ' +
        `no check for ignored RuntimeConfig field(s): ${uncovered.join(', ')}. ` +
        'Add a descriptor to `ignoredKeyWarnings` or `speciallyHandledIgnoredKeys`.',
    );
  }
};
assertIgnoredKeysCovered();

const SUPPORTED_PROVIDERS = ['playwright'] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Object.prototype.toString.call(value) === '[object Object]';
};

const validateViewport = (viewport: unknown): void => {
  if (viewport == null) {
    return;
  }

  if (typeof viewport === 'string') {
    const presetId = viewport.trim();
    if (!presetId) {
      throw new Error('browser.viewport must be a non-empty preset id.');
    }
    if (!resolveBrowserViewportPreset(presetId)) {
      throw new Error(
        `browser.viewport must be a valid preset id. Received: ${viewport}`,
      );
    }
    return;
  }

  if (isPlainObject(viewport)) {
    const width = (viewport as any).width;
    const height = (viewport as any).height;
    if (!Number.isFinite(width) || width <= 0) {
      throw new Error('browser.viewport.width must be a positive number.');
    }
    if (!Number.isFinite(height) || height <= 0) {
      throw new Error('browser.viewport.height must be a positive number.');
    }
    return;
  }

  throw new Error(
    'browser.viewport must be either a preset id or { width, height }.',
  );
};

type BrowserConfigRow = {
  projectName: string;
  browserName: BrowserName;
  headed: boolean;
};

/**
 * One `(project, browser)` row per configured browser of every browser
 * project, computed once per validation pass. The headed, watch-hybrid, and
 * coverage-v8 checks all read the same selection, so they share it.
 */
const browserConfigRows = (context: InternalContext): BrowserConfigRow[] =>
  context.projects.flatMap((project) =>
    project.normalizedConfig.browser.enabled
      ? resolveBrowserInstances(project).map((entry) => ({
          projectName: project.name,
          browserName: entry.browserName,
          headed: entry.headless === false,
        }))
      : [],
  );

/**
 * Warn (or hard-error) on node-only config that is silently ignored under
 * `browser.enabled`. Prevents the #1389 class of silent no-ops. The per-key
 * warnings are driven by the `executorCapabilities` table: the loop iterates
 * {@link browserIgnoredRuntimeConfigKeys} and looks each key up in
 * {@link ignoredKeyWarnings}; `coverage` (and `pool`, which is not a
 * RuntimeConfig field) keep bespoke handling below.
 *
 * Scoping rules: `coverage` and `isolate` are global-only config copied onto
 * every project, so a V8 hard error / isolate warning is scoped to browser-only
 * runs — a mixed repo legitimately sets them for its node projects and must not
 * get unsilenceable noise on a correct configuration.
 */
const reportUnsupportedBrowserOptions = (
  context: InternalContext,
  browserRows: BrowserConfigRow[],
): void => {
  const browserProjects = context.projects.filter(
    (project) => project.normalizedConfig.browser.enabled,
  );
  if (browserProjects.length === 0) {
    return;
  }
  const isBrowserOnlyRun = browserProjects.length === context.projects.length;

  // `coverage`, `pool` and `isolate` are global-only config (not settable per
  // project), read from the root normalized config.
  const globalConfig = context.normalizedConfig;

  const { coverage } = globalConfig;
  // `list` never collects coverage, so the v8 guard must not block listing.
  if (
    context.command !== 'list' &&
    coverage.enabled &&
    coverage.provider === 'v8'
  ) {
    const unsupported = browserRows.find(
      (row) => row.browserName !== 'chromium',
    );
    if (unsupported) {
      const { projectName, browserName } = unsupported;
      // Both screen modes are rejected uniformly (Vitest also hard-errors
      // unless the selected browsers are all chromium): v8 cannot collect in
      // non-V8 engines, and a partially-chromium run would silently lose the
      // non-chromium projects' coverage.
      throw new Error(
        "Coverage provider 'v8' in browser mode requires Chromium. Project " +
          `${JSON.stringify(projectName)} selects ${JSON.stringify(browserName)}. ` +
          "Switch to coverage.provider: 'istanbul', or select Chromium only " +
          '(e.g. CLI `--browser.browsers chromium`).',
      );
    }
  }

  // Node-only options silently ignored under browser.enabled. Collected into a
  // Set so each distinct warning is emitted once, not per project.
  const warnings = new Set<string>();

  if (globalConfig.pool.type !== 'forks') {
    warnings.add(
      `Ignoring pool.type '${globalConfig.pool.type}' in browser mode.`,
    );
  }
  if (globalConfig.pool.execArgv && globalConfig.pool.execArgv.length > 0) {
    warnings.add('Ignoring pool.execArgv in browser mode.');
  }
  // Table-driven warnings: for every browser-ignored RuntimeConfig key, warn
  // when a browser project sets it to a non-default value. `isolate` (and any
  // other global-only key) is copied onto every project, so reading it per
  // project matches the old global read; the Set dedupes the repeats.
  for (const project of browserProjects) {
    const config = project.normalizedConfig;
    for (const key of browserIgnoredRuntimeConfigKeys) {
      const descriptor = ignoredKeyWarnings[key];
      if (!descriptor) {
        // Specially handled elsewhere (e.g. `coverage`).
        continue;
      }
      if (descriptor.browserOnly && !isBrowserOnlyRun) {
        continue;
      }
      if (descriptor.isNonDefault(config)) {
        warnings.add(descriptor.message(config));
      }
    }
  }

  if (
    isBrowserOnlyRun &&
    browserRows.some(
      (row) =>
        row.headed &&
        browserProjects.find((project) => project.name === row.projectName)
          ?.normalizedConfig.isolate === false,
    )
  ) {
    warnings.add(
      'Browser mode keeps headed file frames isolated, so worker-scoped fixtures do not span files when browser.headless is false.',
    );
  }

  if (
    isBrowserOnlyRun &&
    browserProjects.some(
      ({ normalizedConfig: config }) =>
        config.isolate === false && (config.setupFiles?.length ?? 0) > 0,
    )
  ) {
    warnings.add(
      'Browser projects with setupFiles stay file-isolated, even when isolate is false, so setup modules can run for every file.',
    );
  }

  for (const message of warnings) {
    logger.warn(color.yellow(message));
  }
};

export const validateBrowserConfig = (context: InternalContext): void => {
  for (const project of context.projects) {
    const { browser, output } = project.normalizedConfig;
    if (!browser.enabled) {
      continue;
    }

    if (!browser.provider) {
      throw new Error(
        'browser.provider is required when browser.enabled is true.',
      );
    }

    if (!SUPPORTED_PROVIDERS.includes(browser.provider)) {
      throw new Error(
        `browser.provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      );
    }

    validateViewport(browser.viewport);

    // Entry-level viewport overrides must pass the same shape checks as the
    // project value: resolved entries have already merged project defaults,
    // so the entry argument covers both layers.
    for (const entry of resolveBrowserInstances(project)) {
      validateViewport(entry.viewport);
    }

    if (!isPlainObject(browser.providerOptions)) {
      throw new Error('browser.providerOptions must be a plain object.');
    }

    if (output?.bundleDependencies === false) {
      throw new Error(
        'output.bundleDependencies false is not supported in browser mode.',
      );
    }
  }

  // A multi-browser project reports each browser as `<project> (<browser>)`;
  // that name must not collide with another project's, or reporters and
  // blob merges would fold two runs into one.
  const reported = getReportedProjects(context.projects);
  const reportedNames = new Set(
    reported
      .filter(({ name, project }) => name === project.name)
      .map(({ name }) => name),
  );
  for (const { name, project } of reported) {
    if (name !== project.name && reportedNames.has(name)) {
      throw new Error(
        `Project name ${JSON.stringify(name)} is used twice: project ${JSON.stringify(project.name)} runs several browsers and reports each one as "<project> (<browser>)", so rename the project that collides with it.`,
      );
    }
  }

  // Headed debugging works through one container window today, so at most one
  // (project, browser) pair may run headed per run; the rest run headless.
  const browserRows = browserConfigRows(context);
  const headedPairs = browserRows.filter((row) => row.headed);
  if (headedPairs.length > 1) {
    const listed = headedPairs
      .map(
        ({ projectName, browserName }) =>
          `${JSON.stringify(projectName)} (${JSON.stringify(browserName)})`,
      )
      .join(', ');
    throw new Error(
      `Only one (project, browser) pair can run headed per run: ${listed}. Browser mode opens one debug window, so every other browser must set headless: true.` +
        ' Most often this comes from `--browser.headless=false` on a multi-browser run: select a single headless pair with `--browser.browsers <name>` or narrow the projects with `--project`.',
    );
  }

  // Watch rerun planning is single-planner: a headed pair has its own serial
  // reload queue, and a mixed headed+headless watch session would rerun only
  // through the last-installed scheduler. Until the two-watch-owner composition
  // lands, mixed headed+headless is a run-only shape.
  if (
    context.command === 'watch' &&
    headedPairs.length > 0 &&
    browserRows.some((row) => !row.headed)
  ) {
    const { projectName, browserName } = headedPairs[0]!;
    throw new Error(
      `Watch mode does not support mixing headed (${projectName} / ${browserName}) and headless browsers in one run yet: every configured browser must set headless: true, or run without watch.`,
    );
  }

  reportUnsupportedBrowserOptions(context, browserRows);
};
