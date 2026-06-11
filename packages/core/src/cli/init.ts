import { existsSync, readFileSync, statSync } from 'node:fs';
import type { LoadConfigOptions } from '@rsbuild/core';
import { basename, dirname, resolve } from 'pathe';
import { type GlobOptions, glob, isDynamicPattern } from 'tinyglobby';
import { loadConfig, resolveExtends } from '../config';
import type {
  BrowserName,
  Project,
  RstestConfig,
  RstestOutputConfig,
} from '../types';
import {
  castArray,
  color,
  determineAgent,
  filterProjects,
  formatRootStr,
  getAbsolutePath,
} from '../utils';

export type CommonOptions = {
  root?: string;
  config?: string;
  configLoader?: LoadConfigOptions['loader'];
  related?: boolean;
  findRelatedTests?: boolean;
  changed?: boolean | string;
  globals?: boolean;
  /**
   * Pool options.
   * - `string`: shorthand for `{ type: string }` (from `--pool` flag)
   * - `object`: detailed pool config (from `--pool.*` options)
   */
  pool?:
    | string
    | {
        type?: string;
        maxWorkers?: string | number;
        minWorkers?: string | number;
        execArgv?: string[] | string;
      };
  /**
   * Browser mode options.
   * - `boolean`: shorthand for `{ enabled: boolean }` (from `--browser` flag)
   * - `object`: detailed browser config (from `--browser.*` options)
   */
  browser?:
    | boolean
    | {
        enabled?: boolean;
        name?: BrowserName;
        headless?: boolean;
        port?: number;
        strictPort?: boolean;
      };
  isolate?: boolean;
  include?: string[];
  exclude?: string[];
  reporters?: string | string[];
  project?: string[];
  /**
   * Coverage options.
   * - `boolean`: shorthand for `{ enabled: boolean }` (from `--coverage` flag)
   * - `object`: detailed coverage config (from `--coverage.*` options)
   */
  coverage?:
    | boolean
    | {
        enabled?: boolean | string;
        allowExternal?: boolean;
        provider?: 'istanbul' | 'v8';
        include?: string | string[];
        changed?: boolean | string;
        exclude?: string | string[];
        reporters?: string | string[];
        reportsDirectory?: string;
        reportOnFailure?: boolean | string;
        clean?: boolean | string;
      };
  passWithNoTests?: boolean;
  silent?: boolean | 'passed-only';
  printConsoleTrace?: boolean;
  logHeapUsage?: boolean;
  detectAsyncLeaks?: boolean;
  trace?: boolean;
  disableConsoleIntercept?: boolean;
  update?: boolean;
  testNamePattern?: RegExp | string;
  testTimeout?: number;
  hookTimeout?: number;
  testEnvironment?: string;
  clearMocks?: boolean;
  resetMocks?: boolean;
  restoreMocks?: boolean;
  unstubGlobals?: boolean;
  unstubEnvs?: boolean;
  retry?: number;
  maxConcurrency?: number;
  slowTestThreshold?: number;
  hideSkippedTests?: boolean;
  hideSkippedTestFiles?: boolean;
  bail?: number | boolean;
  shard?: string;
  includeTaskLocation?: boolean;
  source?: {
    tsconfigPath?: string;
  };
  dev?: {
    writeToDisk?: boolean;
  };
  output?: Pick<RstestOutputConfig, 'emitAssets' | 'cleanDistPath' | 'module'>;
};

function coerceCliBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }

  return undefined;
}

const normalizeBooleanLikeCliValue = (
  value: boolean | string,
): boolean | string => {
  if (value === 'false') {
    return false;
  }

  if (value === 'true') {
    return true;
  }

  return value;
};

export function mergeWithCLIOptions(
  config: RstestConfig,
  options: CommonOptions,
): RstestConfig {
  const keys: (keyof CommonOptions & keyof RstestConfig)[] = [
    'root',
    'globals',
    'isolate',
    'passWithNoTests',
    'silent',
    'update',
    'testNamePattern',
    'testTimeout',
    'hookTimeout',
    'clearMocks',
    'resetMocks',
    'restoreMocks',
    'unstubEnvs',
    'unstubGlobals',
    'retry',
    'slowTestThreshold',
    'maxConcurrency',
    'printConsoleTrace',
    'disableConsoleIntercept',
    'testEnvironment',
    'hideSkippedTests',
    'hideSkippedTestFiles',
    'logHeapUsage',
    'detectAsyncLeaks',
    'includeTaskLocation',
  ];
  for (const key of keys) {
    if (options[key] !== undefined) {
      (config[key] as any) = options[key];
    }
  }

  if (options.changed !== undefined && options.passWithNoTests === undefined) {
    config.passWithNoTests ??= true;
  }

  if (options.reporters) {
    config.reporters = castArray(options.reporters) as typeof config.reporters;
  }

  if (options.shard) {
    const [index, count] = options.shard.split('/').map(Number);
    if (
      !index ||
      !count ||
      Number.isNaN(index) ||
      Number.isNaN(count) ||
      index < 1 ||
      index > count
    ) {
      throw new Error(
        `Invalid shard option: ${options.shard}. It must be in the format of <index>/<count> and 1-based.`,
      );
    }
    config.shard = {
      index,
      count,
    };
  }

  if (
    options.bail !== undefined &&
    (typeof options.bail === 'number' || typeof options.bail === 'boolean')
  ) {
    config.bail = Number(options.bail);
  }

  if (options.coverage !== undefined) {
    config.coverage ??= {};
    if (typeof options.coverage === 'boolean') {
      config.coverage.enabled = options.coverage;
    } else {
      let changed: boolean | string | undefined;
      let shouldEnableCoverage = false;
      const coverageEnabled = coerceCliBoolean(options.coverage.enabled);
      if (coverageEnabled !== undefined) {
        config.coverage.enabled = coverageEnabled;
      }
      if (options.coverage.allowExternal !== undefined) {
        config.coverage.allowExternal = options.coverage.allowExternal;
        shouldEnableCoverage = true;
      }
      if (options.coverage.provider !== undefined) {
        config.coverage.provider = options.coverage.provider;
        shouldEnableCoverage = true;
      }
      if (options.coverage.include !== undefined) {
        config.coverage.include = castArray(options.coverage.include);
        shouldEnableCoverage = true;
      }
      if (options.coverage.exclude !== undefined) {
        config.coverage.exclude = [
          ...(config.coverage.exclude || []),
          ...castArray(options.coverage.exclude),
        ];
        shouldEnableCoverage = true;
      }
      if (options.coverage.reporters !== undefined) {
        config.coverage.reporters = castArray(
          options.coverage.reporters,
        ) as typeof config.coverage.reporters;
        shouldEnableCoverage = true;
      }
      if (options.coverage.reportsDirectory !== undefined) {
        config.coverage.reportsDirectory = options.coverage.reportsDirectory;
        shouldEnableCoverage = true;
      }
      if (options.coverage.reportOnFailure !== undefined) {
        const reportOnFailure = coerceCliBoolean(
          options.coverage.reportOnFailure,
        );
        if (reportOnFailure !== undefined) {
          config.coverage.reportOnFailure = reportOnFailure;
          shouldEnableCoverage = true;
        }
      }
      if (options.coverage.clean !== undefined) {
        const clean = coerceCliBoolean(options.coverage.clean);
        if (clean !== undefined) {
          config.coverage.clean = clean;
          shouldEnableCoverage = true;
        }
      }
      if (options.coverage.changed !== undefined) {
        changed = normalizeBooleanLikeCliValue(options.coverage.changed);
        config.coverage.changed = changed;
        shouldEnableCoverage ||= changed !== false;
      }

      if (
        coverageEnabled === undefined &&
        options.coverage.enabled === undefined &&
        shouldEnableCoverage
      ) {
        config.coverage.enabled = true;
      }
    }
  }

  if (options.exclude) {
    config.exclude = castArray(options.exclude);
  }

  if (options.include) {
    config.include = castArray(options.include);
  }

  if (options.source?.tsconfigPath !== undefined) {
    config.source ??= {};
    config.source.tsconfigPath = options.source.tsconfigPath;
  }

  if (options.dev?.writeToDisk !== undefined) {
    config.dev ??= {};
    config.dev.writeToDisk = options.dev.writeToDisk;
  }

  if (options.output !== undefined) {
    config.output ??= {};
    if (options.output.emitAssets !== undefined) {
      config.output.emitAssets = options.output.emitAssets;
    }
    if (options.output.cleanDistPath !== undefined) {
      config.output.cleanDistPath = options.output.cleanDistPath;
    }
    if (options.output.module !== undefined) {
      config.output.module = options.output.module;
    }
  }

  if (options.browser !== undefined) {
    config.browser ??= { provider: 'playwright' };
    // Handle --browser as shorthand for --browser.enabled
    if (typeof options.browser === 'boolean') {
      config.browser.enabled = options.browser;
    } else {
      const browserEnabled = coerceCliBoolean(options.browser.enabled);
      if (browserEnabled !== undefined) {
        config.browser.enabled = browserEnabled;
      }
      if (options.browser.name !== undefined) {
        config.browser.browser = options.browser.name;
      }
      if (options.browser.headless !== undefined) {
        config.browser.headless = options.browser.headless;
      }
      if (options.browser.port !== undefined) {
        config.browser.port = Number(options.browser.port);
      }
      if (options.browser.strictPort !== undefined) {
        config.browser.strictPort = options.browser.strictPort;
      }
    }
  }

  if (options.pool !== undefined) {
    const poolFromCli = options.pool;

    if (typeof poolFromCli === 'string') {
      if (typeof config.pool === 'string') {
        config.pool = { type: config.pool };
      }

      config.pool ??= {};
      if (typeof config.pool !== 'object') {
        config.pool = {};
      }

      const pool = config.pool;
      pool.type = poolFromCli as any;
    } else {
      if (typeof config.pool === 'string') {
        config.pool = { type: config.pool };
      }

      config.pool ??= {};
      if (typeof config.pool !== 'object') {
        config.pool = {};
      }

      const pool = config.pool;

      if (poolFromCli.type !== undefined) {
        pool.type = poolFromCli.type as any;
      }

      if (poolFromCli.maxWorkers !== undefined) {
        pool.maxWorkers = poolFromCli.maxWorkers as any;
      }

      if (poolFromCli.minWorkers !== undefined) {
        pool.minWorkers = poolFromCli.minWorkers as any;
      }

      if (poolFromCli.execArgv !== undefined) {
        pool.execArgv = castArray(poolFromCli.execArgv);
      }
    }
  }

  return config;
}

async function resolveConfig(
  options: CommonOptions & { cwd: string },
): Promise<{
  config: RstestConfig;
  configFilePath?: string;
}> {
  const { content: config, filePath: configFilePath } = await loadConfig({
    cwd: options.cwd,
    path: options.config,
    configLoader: options.configLoader,
  });

  const mergedConfig = mergeWithCLIOptions(config, options);

  if (!mergedConfig.root) {
    mergedConfig.root = options.cwd;
  }

  return {
    config: mergedConfig,
    configFilePath: configFilePath ?? undefined,
  };
}

export async function resolveProjects({
  config,
  root,
  options,
}: {
  config: RstestConfig;
  root: string;
  options: CommonOptions;
}): Promise<Project[]> {
  if (!config.projects) {
    return [];
  }

  const getDefaultProjectName = (dir: string) => {
    const pkgJsonPath = resolve(dir, 'package.json');
    const name = existsSync(pkgJsonPath)
      ? JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).name
      : '';

    if (typeof name !== 'string' || !name) {
      return basename(dir);
    }
    return name;
  };

  const globProjects = async (patterns: string[], root: string) => {
    const globOptions: GlobOptions = {
      absolute: true,
      dot: true,
      onlyFiles: false,
      cwd: root,
      expandDirectories: false,
      ignore: ['**/node_modules/**', '**/.DS_Store'],
    };

    return glob(patterns, globOptions);
  };

  const resolvedProjectPaths = new Set<string>();

  const getProjects = async (rstestConfig: RstestConfig, root: string) => {
    const projectPaths: string[] = [];
    const projectPatterns: string[] = [];
    const inlineProjectConfigPromises: Promise<
      | {
          config: RstestConfig;
          configFilePath: string | undefined;
        }
      | {
          error: unknown;
        }
    >[] = [];

    for (const p of rstestConfig.projects || []) {
      if (typeof p === 'object') {
        const projectRoot = p.root ? formatRootStr(p.root, root) : root;

        inlineProjectConfigPromises.push(
          resolveExtends({ ...p }).then(
            (projectConfig) => ({
              config: mergeWithCLIOptions(
                {
                  root: projectRoot,
                  ...projectConfig,
                  name: p.name ? p.name : getDefaultProjectName(projectRoot),
                },
                options,
              ),
              configFilePath: undefined,
            }),
            (error) => ({ error }),
          ),
        );
        continue;
      }

      const projectStr = formatRootStr(p, root);

      if (isDynamicPattern(projectStr)) {
        projectPatterns.push(projectStr);
      } else {
        const absolutePath = getAbsolutePath(root, projectStr);

        if (!existsSync(absolutePath)) {
          throw `Can't resolve project "${p}", please make sure "${p}" is a existing file or a directory.`;
        }
        projectPaths.push(absolutePath);
      }
    }

    const [inlineProjectConfigResults, globbedProjectPaths] = await Promise.all(
      [
        Promise.all(inlineProjectConfigPromises),
        globProjects(projectPatterns, root),
      ],
    );

    const projectConfigs = inlineProjectConfigResults.map((result) => {
      if ('error' in result) {
        throw result.error;
      }

      return result;
    });

    projectPaths.push(...globbedProjectPaths);

    const projects: {
      config: RstestConfig;
      configFilePath?: string;
    }[] = [];

    await Promise.all(
      projectPaths.map(async (project) => {
        const isDirectory = statSync(project).isDirectory();
        const projectRoot = isDirectory ? project : dirname(project);
        const { config, configFilePath } = await resolveConfig({
          ...options,
          config: isDirectory ? undefined : project,
          cwd: projectRoot,
        });

        if (configFilePath) {
          if (resolvedProjectPaths.has(configFilePath)) {
            return;
          }
          resolvedProjectPaths.add(configFilePath);
        }

        config.name ??= getDefaultProjectName(projectRoot);

        if (config.projects?.length) {
          const childProjects = await getProjects(config, projectRoot);
          projects.push(...childProjects);
        } else {
          projects.push({
            config,
            configFilePath,
          });
        }
      }),
    );

    return projects.concat(projectConfigs);
  };

  const projects = await getProjects(config, root).then((p) =>
    filterProjects(p, options),
  );

  if (!projects.length) {
    let errorMsg = `No projects found, please make sure you have at least one valid project.
${color.gray('projects:')} ${JSON.stringify(config.projects, null, 2)}`;

    if (options.project) {
      errorMsg += `\n${color.gray('projectName filter:')} ${JSON.stringify(options.project, null, 2)}`;
    }

    throw errorMsg;
  }

  const names = new Set<string>();

  projects.forEach((project) => {
    if (names.has(project.config.name!)) {
      const conflictProjects = projects.filter(
        (p) => p.config.name === project.config.name,
      );
      throw `Project name "${project.config.name}" is already used. Please ensure all projects have unique names.
Conflicting projects:
${conflictProjects.map((p) => `- ${p.configFilePath || p.config.root}`).join('\n')}
        `;
    }

    names.add(project.config.name!);
  });

  return projects;
}

export async function initCli(options: CommonOptions): Promise<{
  config: RstestConfig;
  configFilePath?: string;
  projects: Project[];
}> {
  const cwd = process.cwd();
  const root = options.root ? getAbsolutePath(cwd, options.root) : cwd;

  const { config, configFilePath } = await resolveConfig({
    ...options,
    cwd: options.root ? getAbsolutePath(cwd, options.root) : cwd,
  });

  // In agent environments, default to markdown output when the user didn't
  // explicitly set reporters (no `reporters` in config and no `--reporters`).
  if (
    determineAgent().isAgent &&
    !options.reporters &&
    config.reporters == null
  ) {
    config.reporters = ['md'];
  }

  const projects = await resolveProjects({ config, root, options });

  return {
    config,
    configFilePath,
    projects,
  };
}
