import {
  type CommonOptions,
  formatNoProjectsFoundError,
  loadCliConfig,
  mergeWithCLIOptions,
  resolveProjects,
} from '../cli/init';
import { clonePlainConfig, resolveExtends } from '../config';
import type { Project, RstestConfig } from '../types';
import { filterProjects, getAbsolutePath } from '../utils';

export type RunnerConfigSource =
  | { type: 'discover' }
  | {
      type: 'value';
      config: RstestConfig;
      configFilePath?: string;
    };

export type ResolvedRunnerInputs = {
  config: RstestConfig;
  configFilePath?: string;
  projects: Project[];
  cwd: string;
};

export function resolveRunnerOperationInputs({
  inputs,
  options,
}: {
  inputs: ResolvedRunnerInputs;
  options: CommonOptions;
}): ResolvedRunnerInputs {
  const config = mergeWithCLIOptions(clonePlainConfig(inputs.config), options);
  config.root = config.root
    ? getAbsolutePath(inputs.cwd, config.root)
    : inputs.cwd;

  const projects = filterProjects(
    inputs.projects.map((project) => ({
      ...project,
      config: mergeWithCLIOptions(clonePlainConfig(project.config), options),
    })),
    options,
  );

  if (inputs.projects.length && !projects.length) {
    throw new Error(formatNoProjectsFoundError(config, options.project));
  }

  return {
    config,
    configFilePath: inputs.configFilePath,
    projects,
    cwd: inputs.cwd,
  };
}

export async function resolveRunnerInputs({
  source,
  options,
  cwd,
  tweakConfig,
}: {
  source: RunnerConfigSource;
  options: CommonOptions;
  cwd: string;
  tweakConfig?: (config: RstestConfig) => void;
}): Promise<ResolvedRunnerInputs> {
  let config: RstestConfig;
  let configFilePath: string | undefined;

  if (source.type === 'discover') {
    const loaded = await loadCliConfig(options, cwd);
    config = loaded.content;
    configFilePath = loaded.filePath ?? undefined;
  } else {
    // Cloning must preserve exclude.override until defaults are applied.
    config = await resolveExtends(clonePlainConfig(source.config));
    configFilePath = source.configFilePath;
  }

  mergeWithCLIOptions(config, options);
  config.root = config.root ? getAbsolutePath(cwd, config.root) : cwd;
  tweakConfig?.(config);

  const projects = await resolveProjects({
    config,
    root: config.root,
    options,
  });

  const names = new Set<string>();
  for (const project of projects) {
    if (names.has(project.config.name!)) {
      const conflictProjects = projects.filter(
        (p) => p.config.name === project.config.name,
      );
      throw `Project name "${project.config.name}" is already used. Please ensure all projects have unique names.
Conflicting projects:
${conflictProjects.map((p) => `- ${p.configFilePath || p.config.root}`).join('\n')}`;
    }

    names.add(project.config.name!);
  }

  return { config, configFilePath, projects, cwd };
}
