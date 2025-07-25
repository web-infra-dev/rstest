import { existsSync, readFileSync } from 'node:fs';
import type { LoadConfigOptions } from '@rsbuild/core';
import { basename, resolve } from 'pathe';
import { isDynamicPattern } from 'tinyglobby';
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

  const names = new Set<string>();

  for (const project of config.projects || []) {
    const projectStr = project.replace('<rootDir>', root);

    if (isDynamicPattern(projectStr)) {
      // TODO
      throw `Dynamic project pattern (${project}) is not supported. Please use static paths.`;
    }

    const absolutePath = getAbsolutePath(root, projectStr);

    const { config, configFilePath } = await resolveConfig({
      ...options,
      root: absolutePath,
    });

    config.name ??= getDefaultProjectName(absolutePath);

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
