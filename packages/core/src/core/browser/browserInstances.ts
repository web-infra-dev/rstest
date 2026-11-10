import type {
  BrowserEntry,
  BrowserExpectConfig,
  BrowserName,
  BrowserViewport,
  InternalProjectContext,
} from '../../types';
import { BROWSER_NAMES, isBrowserName } from '../../utils/browserNames';
import { logger } from '../../utils/logger';

/**
 * A `browser.browsers` entry after defaults are merged: the shape this package
 * schedules and launches against.
 */
export type ResolvedBrowserEntry = {
  browserName: BrowserName;
  headless: boolean;
  viewport?: BrowserViewport;
  screenshotFailures: boolean;
  expect?: BrowserExpectConfig;
  providerOptions: Record<string, unknown>;
};

type ProjectBrowserConfig =
  InternalProjectContext['normalizedConfig']['browser'];

const browserNameList = (): string =>
  BROWSER_NAMES.map((name) => `'${name}'`).join(', ');

/** `[name, raw item]` per entry of a `browsers`-shaped value. */
const expandRawEntries = (
  value: string | BrowserEntry | (string | BrowserEntry)[],
): [string, string | BrowserEntry][] =>
  [value]
    .flat()
    .map((item) => [
      typeof item === 'object' ? String(item.browserName) : String(item),
      item,
    ]);

const rawEntriesOf = (
  browser: ProjectBrowserConfig,
): [string, string | BrowserEntry][] =>
  expandRawEntries(browser.browsers ?? browser.browser ?? 'chromium');

/**
 * CLI selection (`--browser.browsers` / `--browser.name`) against the
 * project's configured browsers: a selected name keeps its configured entry
 * (with its overrides); a name the project does not configure falls back to a
 * plain entry that inherits the project-level defaults.
 */
const selectCliEntries = (
  browser: ProjectBrowserConfig,
  names: string[],
): [string, string | BrowserEntry][] => {
  for (const name of names) {
    if (!isBrowserName(name)) {
      throw new Error(
        `Unknown browser value ${JSON.stringify(name)} for \`--browser.browsers\`. Accepted values: ${browserNameList()}.`,
      );
    }
  }
  const configured = new Map<string, string | BrowserEntry>();
  for (const [name, item] of rawEntriesOf(browser)) {
    // Malformed entries cannot be matched by a name.
    if (isBrowserName(name) && !configured.has(name)) {
      configured.set(name, item);
    }
  }
  return names.map((name) => [name, configured.get(name) ?? name]);
};

/**
 * Overrides per entry field: an entry field set wins, then the project-level
 * default. `providerOptions` merges per top-level key (`launch`, `context`)
 * instead of whole-field, so an entry tweak keeps sibling provider keys.
 */
const resolveEntry = (
  browserName: BrowserName,
  entry: BrowserEntry | undefined,
  defaults: ProjectBrowserConfig,
): ResolvedBrowserEntry => ({
  browserName,
  headless: entry?.headless ?? defaults.headless,
  screenshotFailures: entry?.screenshotFailures ?? defaults.screenshotFailures,
  viewport: entry?.viewport ?? defaults.viewport,
  expect: entry?.expect ?? defaults.expect,
  providerOptions: { ...defaults.providerOptions, ...entry?.providerOptions },
});

let deprecatedBrowserFieldWarned = false;
const warnDeprecatedBrowserField = (): void => {
  if (deprecatedBrowserFieldWarned) {
    return;
  }
  deprecatedBrowserFieldWarned = true;
  logger.warn(
    "`browser.browser` is deprecated and will be removed in 1.0: use `browser.browsers` instead, e.g. `browsers: ['chromium']` or `[{ browserName: 'firefox' }]`.",
  );
};

const resolveBrowserEntries = (
  browser: ProjectBrowserConfig,
): ResolvedBrowserEntry[] => {
  const { cliBrowsers } = browser;
  if (cliBrowsers === undefined) {
    if (browser.browser !== undefined && browser.browsers !== undefined) {
      throw new Error(
        '`browser.browser` and `browser.browsers` cannot be set together: `browser.browser` is deprecated and superseded by `browsers`. Configure `browser.browsers` only.',
      );
    }
    if (browser.browser !== undefined) {
      warnDeprecatedBrowserField();
    }
  }

  const rawEntries =
    cliBrowsers === undefined
      ? rawEntriesOf(browser)
      : selectCliEntries(browser, cliBrowsers);
  if (rawEntries.length === 0) {
    throw new Error(
      '`browser.browsers` must not be empty. Remove the option to run the default Chromium.',
    );
  }

  const entries: ResolvedBrowserEntry[] = [];
  const seen = new Set<BrowserName>();
  for (const [browserName, item] of rawEntries) {
    const entry = typeof item === 'object' ? item : undefined;
    if (!isBrowserName(browserName)) {
      throw new Error(
        `Browser entry must either be a browser name (${browserNameList()}) or an object with a \`browserName\` field of those values. Received: ${JSON.stringify(entry ?? item)}.`,
      );
    }
    if (seen.has(browserName)) {
      throw new Error(
        `Browser '${browserName}' appears twice in \`browser.browsers\`: each browser may be configured at most once per project.`,
      );
    }
    seen.add(browserName);
    entries.push(resolveEntry(browserName, entry, browser));
  }
  return entries;
};

/**
 * One `(project, browser)` pair of a browser project. Everything outside
 * `@rstest/browser` sees an instance as a plain project named {@link name}:
 * reporters, the event sink, task ids and blob keys never carry a browser.
 */
export type BrowserInstance = ResolvedBrowserEntry & {
  /**
   * The project name the instance reports under: the project's own name when
   * it runs one browser, `<project> (<browser>)` when it runs several.
   */
  name: string;
};

const instancesByConfig = new WeakMap<object, BrowserInstance[]>();

/**
 * The only place a project's browser instances are resolved: raw
 * `browser.browsers` / deprecated `browser.browser` / CLI selection (stored
 * untouched by config normalization) → one instance per browser with the
 * project-level defaults merged. Shape errors throw here; browser validation
 * calls it for every browser project, so they surface before any test or
 * browser launch. Memoized per project browser config so every caller of a
 * run sees the same instances and the deprecation warning fires once.
 */
export const resolveBrowserInstances = (
  project: Pick<InternalProjectContext, 'name' | 'normalizedConfig'>,
): BrowserInstance[] => {
  const { browser } = project.normalizedConfig;
  let instances = instancesByConfig.get(browser);
  if (!instances) {
    const entries = resolveBrowserEntries(browser);
    instances = entries.map((entry) => ({
      ...entry,
      name:
        entries.length > 1
          ? `${project.name} (${entry.browserName})`
          : project.name,
    }));
    instancesByConfig.set(browser, instances);
  }
  return instances;
};

/**
 * The project names a run reports under, each paired with the project whose
 * config it uses: a node project reports as itself, a browser project as each
 * of its {@link BrowserInstance}s.
 */
export const getReportedProjects = (
  projects: readonly InternalProjectContext[],
): { name: string; project: InternalProjectContext }[] =>
  projects.flatMap((project) =>
    project.normalizedConfig.browser.enabled
      ? resolveBrowserInstances(project).map(({ name }) => ({ name, project }))
      : [{ name: project.name, project }],
  );
