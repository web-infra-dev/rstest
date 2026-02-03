import { existsSync, readFileSync, statSync } from 'node:fs';
import type { LoadConfigOptions } from '@rsbuild/core';
import { basename, dirname, resolve } from 'pathe';
import { type GlobOptions, glob, isDynamicPattern } from 'tinyglobby';
import { loadConfig, mergeRstestConfig } from '../config';
import type { BrowserName, Project, RstestConfig } from '../types';
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
  reporter?: string[];
  project?: string[];
  coverage?: boolean;
  passWithNoTests?: boolean;
  printConsoleTrace?: boolean;
  logHeapUsage?: boolean;
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
};

function mergeWithCLIOptions(
  config: RstestConfig,
  options: CommonOptions,
): RstestConfig {
  const keys: (keyof CommonOptions & keyof RstestConfig)[] = [
    'root',
    'globals',
    'isolate',
    'passWithNoTests',
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
  ];
  for (const key of keys) {
    if (options[key] !== undefined) {
      (config[key] as any) = options[key];
    }
  }

  if (options.reporter) {
    config.reporters = castArray(options.reporter) as typeof config.reporters;
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
    config.coverage.enabled = options.coverage;
  }

  if (options.exclude) {
    config.exclude = castArray(options.exclude);
  }

  if (options.include) {
    config.include = castArray(options.include);
  }

  if (options.browser !== undefined) {
    config.browser ??= { provider: 'playwright' };
    // Handle --browser as shorthand for --browser.enabled
    if (typeof options.browser === 'boolean') {
      config.browser.enabled = options.browser;
    } else {
      if (options.browser.enabled !== undefined) {
        config.browser.enabled = options.browser.enabled;
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
    const projectConfigs: {
      config: RstestConfig;
      configFilePath: string | undefined;
    }[] = [];

    await Promise.all(
      (rstestConfig.projects || []).map(async (p) => {
        if (typeof p === 'object') {
          const projectRoot = p.root ? formatRootStr(p.root, root) : root;

          // Handle extends
          let projectConfig: RstestConfig = { ...p };
          if (projectConfig.extends) {
            const extendsConfig =
              typeof projectConfig.extends === 'function'
                ? await projectConfig.extends(
                    Object.freeze({ ...projectConfig }),
                  )
                : projectConfig.extends;
            delete (extendsConfig as RstestConfig).projects;
            projectConfig = mergeRstestConfig(extendsConfig, projectConfig);
          }

          projectConfigs.push({
            config: mergeWithCLIOptions(
              {
                root: projectRoot,
                ...projectConfig,
                name: p.name ? p.name : getDefaultProjectName(projectRoot),
              },
              options,
            ),
            configFilePath: undefined,
          });
          return;
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
      }),
    );

    projectPaths.push(...(await globProjects(projectPatterns, root)));

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
  // explicitly set reporters (no `reporters` in config and no `--reporter`).
  if (
    determineAgent().isAgent &&
    !options.reporter &&
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
