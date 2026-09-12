import type { LoadConfigResult } from '@rsbuild/core';
import {
  type CommonOptions,
  formatNoProjectsFoundError,
  mergeWithCLIOptions,
  resolveProjects,
} from '../cli/init';
import { clonePlainConfig, resolveExtends } from '../config';
import type { Project, RstestConfig } from '../types';
import { filterProjects, getAbsolutePath } from '../utils';

export type ResolvedRunnerInputs = {
  result: LoadConfigResult<RstestConfig>;
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
  const config = mergeWithCLIOptions(
    clonePlainConfig(inputs.result.content),
    options,
  );
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
    result: { ...inputs.result, content: config },
    projects,
    cwd: inputs.cwd,
  };
}

export async function resolveRunnerInputs({
  result,
  options,
  cwd,
}: {
  result: LoadConfigResult<RstestConfig>;
  options: CommonOptions;
  cwd: string;
}): Promise<ResolvedRunnerInputs> {
  // Cloning must preserve exclude.override until defaults are applied.
  const config = await resolveExtends(clonePlainConfig(result.content));

  mergeWithCLIOptions(config, options);
  config.root = config.root ? getAbsolutePath(cwd, config.root) : cwd;

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

  return { result: { ...result, content: config }, projects, cwd };
}
