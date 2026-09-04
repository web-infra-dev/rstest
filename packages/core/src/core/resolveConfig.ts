import {
  type CommonOptions,
  formatNoProjectsFoundError,
  mergeWithCLIOptions,
  resolveProjects,
} from '../cli/init';
import { loadConfig, mergeRstestConfig, resolveExtends } from '../config';
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
  const config = mergeWithCLIOptions(
    mergeRstestConfig({}, inputs.config),
    options,
  );
  config.root = config.root
    ? getAbsolutePath(inputs.cwd, config.root)
    : inputs.cwd;

  const projects = filterProjects(
    inputs.projects.map((project) => ({
      ...project,
      config: mergeWithCLIOptions(
        mergeRstestConfig({}, project.config),
        options,
      ),
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
    const discoveryRoot = options.root
      ? getAbsolutePath(cwd, options.root)
      : cwd;
    const loaded = await loadConfig({
      cwd: discoveryRoot,
      path: options.config,
      configLoader: options.configLoader,
    });
    config = loaded.content;
    configFilePath = loaded.filePath ?? undefined;
  } else {
    config = await resolveExtends(mergeRstestConfig({}, source.config));
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

  return { config, configFilePath, projects, cwd };
}
