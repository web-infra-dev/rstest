import { existsSync, readFileSync, statSync } from 'node:fs';
import type { LoadConfigOptions } from '@rsbuild/core';
import { basename, dirname, resolve } from 'pathe';
import { type GlobOptions, glob, isDynamicPattern } from 'tinyglobby';
import { loadConfig } from '../config';
import type { Project, RstestConfig } from '../types';
import {
  castArray,
  color,
  filterProjects,
  formatRootStr,
  getAbsolutePath,
} from '../utils';

export type CommonOptions = {
  root?: string;
  config?: string;
  configLoader?: LoadConfigOptions['loader'];
  globals?: boolean;
  browser?: boolean;
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
  bail?: number | boolean;
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

  if (options.browser !== undefined) {
    config.browser ??= {};
    config.browser.enabled = options.browser;
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
    const { projectPaths, projectPatterns, projectConfigs } = (
      rstestConfig.projects || []
    ).reduce(
      (total, p) => {
        if (typeof p === 'object') {
          const projectRoot = p.root ? formatRootStr(p.root, root) : root;
          total.projectConfigs.push({
            config: mergeWithCLIOptions(
              {
                root: projectRoot,
                ...p,
                name: p.name ? p.name : getDefaultProjectName(projectRoot),
              },
              options,
            ),
            configFilePath: undefined,
          });
          return total;
        }
        const projectStr = formatRootStr(p, root);

        if (isDynamicPattern(projectStr)) {
          total.projectPatterns.push(projectStr);
        } else {
          const absolutePath = getAbsolutePath(root, projectStr);

          if (!existsSync(absolutePath)) {
            throw `Can't resolve project "${p}", please make sure "${p}" is a existing file or a directory.`;
          }
          total.projectPaths.push(absolutePath);
        }
        return total;
      },
      {
        projectPaths: [] as string[],
        projectPatterns: [] as string[],
        projectConfigs: [] as {
          config: RstestConfig;
          configFilePath: string | undefined;
        }[],
      },
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

  const projects = await resolveProjects({ config, root, options });

  return {
    config,
    configFilePath,
    projects,
  };
}
