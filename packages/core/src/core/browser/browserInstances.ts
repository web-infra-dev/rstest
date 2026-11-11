import type {
  BrowserExpectConfig,
  BrowserInstanceConfig,
  BrowserName,
  BrowserViewport,
  InternalProjectContext,
} from '../../types';
import { BROWSER_NAMES, isBrowserName } from '../../utils/browserNames';
import { logger } from '../../utils/logger';

/**
 * A `browser.instances` item after defaults are merged: the shape this package
 * schedules and launches against.
 */
export type ResolvedBrowserInstance = {
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

/**
 * The project's configured instances, shape-checked: raw `browser.instances`,
 * else the deprecated `browser.browser`, else the default Chromium instance.
 */
const configuredInstancesOf = (
  browser: ProjectBrowserConfig,
): BrowserInstanceConfig[] => {
  const { instances } = browser;
  if (instances !== undefined && browser.browser !== undefined) {
    throw new Error(
      "`browser.browser` and `browser.instances` cannot be set together: `browser.browser` is deprecated and superseded by `instances`. Configure `browser.instances` only, e.g. `instances: [{ browserName: 'chromium' }]`.",
    );
  }
  if (instances === undefined) {
    return [{ browserName: browser.browser ?? 'chromium' }];
  }
  if (!Array.isArray(instances)) {
    throw new Error(
      `\`browser.instances\` must be an array of objects, e.g. \`[{ browserName: 'chromium' }]\`. Received: ${JSON.stringify(instances)}.`,
    );
  }
  if (instances.length === 0) {
    throw new Error(
      '`browser.instances` must not be empty. Remove the option to run the default Chromium.',
    );
  }
  const seen = new Set<string>();
  for (const item of instances as unknown[]) {
    if (typeof item === 'string') {
      throw new Error(
        `Browser instance must be an object, not a string. Use \`{ browserName: ${JSON.stringify(item)} }\` instead of ${JSON.stringify(item)} in \`browser.instances\`.`,
      );
    }
    const browserName =
      typeof item === 'object' && item !== null
        ? (item as { browserName?: unknown }).browserName
        : undefined;
    if (typeof browserName !== 'string' || !isBrowserName(browserName)) {
      throw new Error(
        `Browser instance must be an object with a \`browserName\` field of ${browserNameList()}. Received: ${JSON.stringify(item)}.`,
      );
    }
    if (seen.has(browserName)) {
      throw new Error(
        `Browser '${browserName}' appears twice in \`browser.instances\`: each browser may be configured at most once per project.`,
      );
    }
    seen.add(browserName);
  }
  return instances;
};

const assertCliBrowserName = (name: string, source: string): BrowserName => {
  if (!isBrowserName(name)) {
    throw new Error(
      `Unknown browser value ${JSON.stringify(name)} for ${source}. Accepted values: ${browserNameList()}.`,
    );
  }
  return name;
};

/**
 * CLI selection against the configured instances. `--browser.instances` only
 * filters (an instance is never created from a name); the deprecated
 * `--browser.name` runs that one browser, with the configured instance's
 * overrides when there is one and project defaults otherwise.
 */
const selectCliInstances = (
  browser: ProjectBrowserConfig,
  configured: BrowserInstanceConfig[],
): BrowserInstanceConfig[] => {
  const { cliInstances, cliBrowserName } = browser;
  if (cliBrowserName !== undefined) {
    const name = assertCliBrowserName(cliBrowserName, '`--browser.name`');
    return [
      configured.find((item) => item.browserName === name) ?? {
        browserName: name,
      },
    ];
  }
  if (cliInstances === undefined) {
    return configured;
  }
  const seen = new Set<string>();
  for (const name of cliInstances) {
    assertCliBrowserName(name, '`--browser.instances`');
    if (seen.has(name)) {
      throw new Error(
        `Browser '${name}' appears twice in \`--browser.instances\`: list each browser at most once.`,
      );
    }
    seen.add(name);
  }
  return configured.filter((item) => seen.has(item.browserName));
};

/**
 * Overrides per instance field: an instance field set wins, then the
 * project-level default. `providerOptions` merges per top-level key (`launch`,
 * `context`) instead of whole-field, so an instance tweak keeps sibling
 * provider keys.
 */
const resolveInstance = (
  instance: BrowserInstanceConfig,
  defaults: ProjectBrowserConfig,
): ResolvedBrowserInstance => ({
  browserName: instance.browserName,
  headless: instance.headless ?? defaults.headless,
  screenshotFailures:
    instance.screenshotFailures ?? defaults.screenshotFailures,
  viewport: instance.viewport ?? defaults.viewport,
  expect: instance.expect ?? defaults.expect,
  providerOptions: {
    ...defaults.providerOptions,
    ...instance.providerOptions,
  },
});

let deprecatedBrowserFieldWarned = false;
const warnDeprecatedBrowserField = (): void => {
  if (deprecatedBrowserFieldWarned) {
    return;
  }
  deprecatedBrowserFieldWarned = true;
  logger.warn(
    "`browser.browser` is deprecated and will be removed in 1.0: use `browser.instances` instead, e.g. `instances: [{ browserName: 'chromium' }]`.",
  );
};

/**
 * One `(project, browser)` pair of a browser project. Everything outside
 * `@rstest/browser` sees an instance as a plain project named {@link name}:
 * reporters, the event sink, task ids and blob keys never carry a browser.
 */
export type BrowserInstance = ResolvedBrowserInstance & {
  /**
   * The project name the instance reports under: the project's own name when
   * it runs one browser, `<project> (<browser>)` when it runs several.
   */
  name: string;
};

/**
 * The only place a project's browser instances are resolved: raw
 * `browser.instances` / deprecated `browser.browser` / CLI selection (stored
 * untouched by config normalization) → one instance per browser with the
 * project-level defaults merged. A CLI selection that matches none of the
 * project's instances yields an empty list: see
 * {@link selectCliInstanceProjects}. Shape errors throw here; browser
 * validation calls it for every browser project, so they surface before any
 * test or browser launch.
 */
export const resolveBrowserInstances = (
  project: Pick<InternalProjectContext, 'name' | 'normalizedConfig'>,
): BrowserInstance[] => {
  const { browser } = project.normalizedConfig;
  const configured = configuredInstancesOf(browser);
  if (browser.browser !== undefined && browser.cliBrowserName === undefined) {
    warnDeprecatedBrowserField();
  }
  const resolved = selectCliInstances(browser, configured).map((instance) =>
    resolveInstance(instance, browser),
  );
  return resolved.map((instance) => ({
    ...instance,
    name:
      resolved.length > 1
        ? `${project.name} (${instance.browserName})`
        : project.name,
  }));
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

/**
 * Applies `--browser.instances` at the project level, like `--project`: a
 * browser project with no matching instance is dropped from the run, node
 * projects are untouched. A name that no selected browser project configures
 * is an error naming the configured browsers per project.
 */
export const selectCliInstanceProjects = <
  P extends Pick<InternalProjectContext, 'name' | 'normalizedConfig'>,
>(
  projects: P[],
): P[] => {
  const browserProjects = projects.filter(
    (project) => project.normalizedConfig.browser.enabled,
  );
  const cliInstances = browserProjects.find(
    (project) => project.normalizedConfig.browser.cliInstances !== undefined,
  )?.normalizedConfig.browser.cliInstances;
  if (!cliInstances) {
    return projects;
  }

  const configured = browserProjects.map((project) => ({
    project,
    names: configuredInstancesOf(project.normalizedConfig.browser).map(
      ({ browserName }): string => browserName,
    ),
  }));
  for (const name of cliInstances) {
    if (!configured.some(({ names }) => names.includes(name))) {
      const perProject = configured
        .map(
          ({ project, names }) =>
            `${JSON.stringify(project.name)}: ${names.join(', ')}`,
        )
        .join('; ');
      throw new Error(
        `Browser ${JSON.stringify(name)} from \`--browser.instances\` is not configured by any selected browser project. Configured browsers per project: ${perProject}.`,
      );
    }
  }

  return projects.filter(
    (project) =>
      !project.normalizedConfig.browser.enabled ||
      resolveBrowserInstances(project).length > 0,
  );
};
