import { normalize, relative, resolve } from 'pathe';
import picomatch from 'picomatch';
import type { CommonOptions } from '../cli/init';
import type {
  FileFilterMode,
  Project,
  RstestCommand,
  RstestConfig,
  RstestInstance,
} from '../types';
import { logger } from '../utils';
import type { ResolvedRunnerInputs } from './resolveConfig';

export type CreateRstestContextFn<
  Instance extends RstestInstance = RstestInstance,
> = (
  input: {
    config: RstestConfig;
    configFilePath?: string;
    projects: Project[];
    cwd?: string;
    trace?: boolean;
    embedded?: boolean;
  },
  command: RstestCommand,
  fileFilters?: string[],
  fileFilterMode?: FileFilterMode,
) => Instance;

export const normalizeRunnerFilters = (
  filters: ReadonlyArray<string | number> | undefined,
): string[] | undefined => filters?.map((filter) => normalize(String(filter)));

const isChangedRun = (changed: CommonOptions['changed']): boolean =>
  changed !== undefined && changed !== false;

export const isRelatedRun = (options: CommonOptions): boolean =>
  options.related === true ||
  options.findRelatedTests === true ||
  isChangedRun(options.changed);

export const validateRelatedOptions = (options: CommonOptions): void => {
  const count = [
    options.related === true,
    options.findRelatedTests === true,
    isChangedRun(options.changed),
  ].filter(Boolean).length;

  if (count > 1) {
    throw new Error(
      'Options `--related`, `--findRelatedTests`, and `--changed` cannot be used together.',
    );
  }
};

const formatGitError = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    if ('code' in error && error.code === 'ENOENT') {
      return 'Git is not installed or not available on PATH.';
    }

    const stderr = 'stderr' in error ? error.stderr : undefined;
    if (typeof stderr === 'string' && stderr.trim()) {
      return stderr.trim().split('\n')[0];
    }

    if (error.message) {
      return error.message;
    }
  }

  return undefined;
};

export const getForceRerunTriggers = ({
  rootTriggers,
  projects,
}: {
  rootTriggers: string[];
  projects: Array<{ normalizedConfig: { forceRerunTriggers: string[] } }>;
}): string[] =>
  Array.from(
    new Set([
      ...rootTriggers,
      ...projects.flatMap(
        (project) => project.normalizedConfig.forceRerunTriggers,
      ),
    ]),
  );

export const getForceRerunTriggerFiles = ({
  changedFiles,
  triggers,
  rootPath,
}: {
  changedFiles: string[];
  triggers: string[];
  rootPath: string;
}): string[] => {
  if (!triggers.length || !changedFiles.length) {
    return [];
  }

  const matcher = picomatch(
    triggers.map((trigger) => normalize(trigger)),
    { windows: true },
  );

  return changedFiles.filter(
    (file) =>
      matcher(normalize(relative(rootPath, file))) || matcher(normalize(file)),
  );
};

export const hasForceRerunTrigger = ({
  changedFiles,
  triggers,
  rootPath,
}: {
  changedFiles: string[];
  triggers: string[];
  rootPath: string;
}): boolean =>
  getForceRerunTriggerFiles({ changedFiles, triggers, rootPath }).length > 0;

export const resolveChangedFiles = async (
  cwd: string,
  since?: string,
): Promise<string[]> => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const normalizedCwd = normalize(cwd);
  const runGit = async (args: string[], gitCwd = cwd) => {
    const { stdout } = await execFileAsync('git', args, {
      cwd: gitCwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  };
  const gitRoot = async () => {
    const cdup = await runGit(['rev-parse', '--show-cdup']);
    return normalize(resolve(cwd, cdup.trim()));
  };
  const git = async (args: string[], root: string) => {
    const stdout = await runGit(args, root);
    return stdout
      .split('\0')
      .filter(Boolean)
      .map((file) => normalize(resolve(root, file)));
  };

  try {
    const root = await gitRoot();
    const [committed, staged, unstaged] = await Promise.all([
      since
        ? git(
            [
              'diff',
              '--name-only',
              '-z',
              '--diff-filter=ACMRTUXB',
              `${since}...HEAD`,
            ],
            root,
          )
        : [],
      git(
        ['diff', '--name-only', '-z', '--cached', '--diff-filter=ACMRTUXB'],
        root,
      ),
      git(
        ['ls-files', '-z', '--others', '--modified', '--exclude-standard'],
        root,
      ),
    ]);
    return Array.from(new Set([...committed, ...staged, ...unstaged])).sort();
  } catch (error) {
    const reason = formatGitError(error);
    throw new Error(
      `Failed to resolve changed files for \`--changed\` from ${normalizedCwd}. Make sure the current root is inside a Git repository.${reason ? ` Git error: ${reason}` : ''}`,
      { cause: error },
    );
  }
};

const getCoverageChangedOption = (options: CommonOptions) =>
  options.coverage === undefined || typeof options.coverage === 'boolean'
    ? undefined
    : options.coverage.changed;

const resolveEffectiveFilters = async ({
  options,
  filters,
  filterMode,
  createRstestContext,
  inputs,
  embedded,
}: {
  options: CommonOptions;
  filters?: ReadonlyArray<string | number>;
  filterMode?: FileFilterMode;
  createRstestContext: CreateRstestContextFn;
  inputs: ResolvedRunnerInputs;
  embedded: boolean;
}) => {
  const normalizedFilters = normalizeRunnerFilters(filters);
  if (!isRelatedRun(options)) {
    return {
      effectiveFilters: normalizedFilters,
      fileFilterMode: filterMode ?? ('fuzzy' as const),
    };
  }

  validateRelatedOptions(options);
  const changedRun = isChangedRun(options.changed);
  if (changedRun && normalizedFilters?.length) {
    throw new Error(
      'The `--changed` option cannot be used with positional filters.',
    );
  }

  const { config, configFilePath, projects, cwd } = inputs;
  const rstest = createRstestContext(
    { config, configFilePath, projects, cwd, embedded },
    'list',
    undefined,
  );
  const sourceFilters = changedRun
    ? await resolveChangedFiles(
        rstest.context.rootPath,
        typeof options.changed === 'string' ? options.changed : undefined,
      )
    : (normalizedFilters ?? []);
  const forceRerunFiles = changedRun
    ? getForceRerunTriggerFiles({
        changedFiles: sourceFilters,
        triggers: getForceRerunTriggers({
          rootTriggers: rstest.context.normalizedConfig.forceRerunTriggers,
          projects: rstest.context.projects,
        }),
        rootPath: rstest.context.rootPath,
      })
    : [];

  if (forceRerunFiles.length) {
    return {
      effectiveFilters: undefined,
      fileFilterMode: undefined,
      relatedFilters: sourceFilters,
      relatedMode: 'changed' as const,
      relatedResolutionEmpty: false,
      relatedRerunReason: 'forceRerunTrigger' as const,
      relatedRerunFiles: forceRerunFiles.map((file) =>
        normalize(relative(rstest.context.rootPath, file)),
      ),
    };
  }

  const { resolveRelatedTestFiles } = await import('./related');
  const relatedFiles = await resolveRelatedTestFiles(rstest.context, {
    sourceFilters,
    filterLabel: changedRun ? '--changed' : '--related',
    allowEmpty: changedRun,
  });

  return {
    effectiveFilters: relatedFiles,
    fileFilterMode: 'exact' as const,
    relatedFilters: sourceFilters,
    relatedMode: changedRun ? ('changed' as const) : ('related' as const),
    relatedResolutionEmpty: relatedFiles.length === 0,
    changedCoverageFilters:
      changedRun && getCoverageChangedOption(options) === undefined
        ? sourceFilters
        : undefined,
  };
};

const resolveCoverageChangedFilters = async (
  rstest: RstestInstance,
): Promise<string[] | undefined> => {
  const { changed } = rstest.context.normalizedConfig.coverage;
  if (changed === undefined) {
    return rstest.context.changedCoverageFilters;
  }
  if (changed === false) {
    return undefined;
  }

  try {
    return await resolveChangedFiles(
      rstest.context.rootPath,
      typeof changed === 'string' ? changed : undefined,
    );
  } catch (error) {
    const reason = formatGitError(error);
    logger.warn(
      `Failed to resolve changed files for \`coverage.changed\`, falling back to full coverage.${reason ? ` Git error: ${reason}` : ''}`,
    );
    return undefined;
  }
};

export async function buildResolvedRunner<Instance extends RstestInstance>({
  inputs,
  options,
  command,
  filters,
  filterMode,
  createRstestContext,
  embedded = false,
}: {
  inputs: ResolvedRunnerInputs;
  options: CommonOptions;
  command: RstestCommand;
  filters?: ReadonlyArray<string | number>;
  filterMode?: FileFilterMode;
  createRstestContext: CreateRstestContextFn<Instance>;
  embedded?: boolean;
}): Promise<Instance> {
  const selection = await resolveEffectiveFilters({
    options,
    filters,
    filterMode,
    createRstestContext,
    inputs,
    embedded,
  });
  const rstest = createRstestContext(
    {
      config: inputs.config,
      configFilePath: inputs.configFilePath,
      projects: inputs.projects,
      cwd: inputs.cwd,
      trace: options.trace,
      embedded,
    },
    command,
    selection.effectiveFilters,
    selection.fileFilterMode,
  );

  rstest.context.relatedFilters = selection.relatedFilters;
  rstest.context.relatedMode = selection.relatedMode;
  rstest.context.relatedResolutionEmpty = selection.relatedResolutionEmpty;
  rstest.context.changedCoverageFilters = selection.changedCoverageFilters;
  rstest.context.changedCoverageFilters =
    await resolveCoverageChangedFilters(rstest);
  rstest.context.relatedRerunReason = selection.relatedRerunReason;
  rstest.context.relatedRerunFiles = selection.relatedRerunFiles;
  return rstest;
}
