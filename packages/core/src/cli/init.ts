import { existsSync, readFileSync } from 'node:fs';
import type { LoadConfigOptions } from '@rsbuild/core';
import { basename, resolve } from 'pathe';
import { type GlobOptions, glob, isDynamicPattern } from 'tinyglobby';
import { loadConfig } from '../config';
import type { Project, RstestConfig } from '../types';
import { castArray, getAbsolutePath } from '../utils/helper';

export type CommonOptions = {
  root?: string;
  config?: string;
  configLoader?: LoadConfigOptions['loader'];
  globals?: boolean;
  isolate?: boolean;
  include?: string[];
  exclude?: string[];
  reporter?: string[];
  passWithNoTests?: boolean;
  printConsoleTrace?: boolean;
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
};

async function resolveConfig(
  options: CommonOptions & Required<Pick<CommonOptions, 'root'>>,
): Promise<{
  config: RstestConfig;
  configFilePath: string | null;
}> {
  const { content: config, filePath: configFilePath } = await loadConfig({
    cwd: options.root,
    path: options.config,
    configLoader: options.configLoader,
  });

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
  ];
  for (const key of keys) {
    if (options[key] !== undefined) {
      (config[key] as any) = options[key];
    }
  }

  if (options.reporter) {
    config.reporters = castArray(options.reporter) as typeof config.reporters;
  }

  if (options.exclude) {
    config.exclude = castArray(options.exclude);
  }

  if (options.include) {
    config.include = castArray(options.include);
  }

  return {
    config,
    configFilePath,
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
  const projects: Project[] = [];

  if (!config.projects || !config.projects.length) {
    return projects;
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

  const globProjects = async (patterns: string[]) => {
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

  const { projectPaths, projectPatterns } = (config.projects || []).reduce(
    (total, p) => {
      const projectStr = p.replace('<rootDir>', root);

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
    },
  );

  projectPaths.push(...(await globProjects(projectPatterns)));

  const names = new Set<string>();

  for (const project of projectPaths || []) {
    const { config, configFilePath } = await resolveConfig({
      ...options,
      root: project,
    });

    config.name ??= getDefaultProjectName(project);

    projects.push({
      config,
      configFilePath,
    });

    if (names.has(config.name)) {
      const conflictProjects = projects.filter(
        (p) => p.config.name === config.name,
      );
      throw `Project name "${config.name}" is already used. Please ensure all projects have unique names.
Conflicting projects:
${conflictProjects.map((p) => `- ${p.configFilePath || p.config.root}`).join('\n')}
        `;
    }

    names.add(config.name);
  }
  return projects;
}

export async function initCli(options: CommonOptions): Promise<{
  config: RstestConfig;
  configFilePath: string | null;
  projects: Project[];
}> {
  const cwd = process.cwd();
  const root = options.root ? getAbsolutePath(cwd, options.root) : cwd;

  const { config, configFilePath } = await resolveConfig({
    ...options,
    root,
  });

  const projects = await resolveProjects({ config, root, options });

  return {
    config,
    configFilePath,
    projects,
  };
}
