import cac, { type CAC, type Command } from 'cac';
import { normalize, relative, resolve } from 'pathe';
import picomatch from 'picomatch';
import type {
  FileFilterMode,
  ListCommandOptions,
  Project,
  RstestCommand,
  RstestConfig,
  RstestInstance,
} from '../types';
import { color, determineAgent, formatError, logger } from '../utils';
import type { CommonOptions } from './init';
import { showRstest } from './prepare';

export type { CommonOptions } from './init';

type OptionConfig = {
  default?: string;
};

type OptionDefinition = readonly [
  rawName: string,
  description: string,
  config?: OptionConfig,
];

const runtimeOptionDefinitions: OptionDefinition[] = [
  [
    '-c, --config <config>',
    'Specify the configuration file, can be a relative or absolute path',
  ],
  [
    '--config-loader <loader>',
    'Specify the loader to load the config file (auto | jiti | native)',
    { default: 'auto' },
  ],
  [
    '-r, --root <root>',
    'Specify the project root directory, can be an absolute path or a path relative to cwd',
  ],
  [
    '--related',
    'Treat positional arguments as source file paths and run only related tests',
  ],
  ['--findRelatedTests', 'Alias for --related for Jest compatibility'],
  [
    '--changed [commit]',
    'Run tests related to changed files in the current Git repository, optionally since a commit',
  ],
  ['--globals', 'Provide global APIs'],
  ['--isolate', 'Run tests in an isolated environment'],
  ['--include <include>', 'Match test files'],
  ['--exclude <exclude>', 'Exclude files from test'],
  ['-u, --update', 'Update snapshot files'],
  ['--coverage', 'Enable code coverage collection'],
  [
    '--coverage.provider <provider>',
    'Coverage provider to use (istanbul | v8)',
  ],
  [
    '--coverage.changed [commit]',
    'Collect coverage only for changed files, optionally since a commit',
  ],
  [
    '--project <name>',
    'Run only projects that match the name, can be a full name or wildcards pattern',
  ],
  [
    '--passWithNoTests',
    'Allows the test suite to pass when no files are found',
  ],
  [
    '--silent [value]',
    'Silence intercepted test console output (true | false | passed-only)',
  ],
  [
    '--printConsoleTrace',
    'Print console traces when calling any console method',
  ],
  ['--disableConsoleIntercept', 'Disable console intercept'],
  ['--logHeapUsage', 'Log heap usage after each test'],
  ['--detectAsyncLeaks', 'Detect async resources that leak after tests finish'],
  ['--trace', 'Dump a Perfetto-compatible performance trace JSON file'],
  [
    '--slowTestThreshold <value>',
    'The number of milliseconds after which a test or suite is considered slow',
  ],
  ['--reporter <reporter>', 'Specify the reporter to use'],
  [
    '-t, --testNamePattern <value>',
    'Run only tests with a name that matches the regex',
  ],
  ['--testEnvironment <name>', 'The environment that will be used for testing'],
  ['--testTimeout <value>', 'Timeout of a test in milliseconds'],
  ['--hookTimeout <value>', 'Timeout of hook in milliseconds'],
  ['--hideSkippedTests', 'Hide skipped tests from the output'],
  ['--hideSkippedTestFiles', 'Hide skipped test files from the output'],
  ['--retry <retry>', 'Number of times to retry a test if it fails'],
  [
    '--bail [number]',
    'Stop running tests after n failures. Set to 0 to run all tests regardless of failures',
  ],
  [
    '--shard <index/count>',
    'Split tests into several shards. This is useful for running tests in parallel on multiple machines.',
  ],
  ['--maxConcurrency <value>', 'Maximum number of concurrent tests'],
  [
    '--clearMocks',
    'Automatically clear mock calls, instances, contexts and results before every test',
  ],
  ['--resetMocks', 'Automatically reset mock state before every test'],
  [
    '--restoreMocks',
    'Automatically restore mock state and implementation before every test',
  ],
  ['--browser', 'Run tests in browser mode'],
  ['--browser.enabled', 'Run tests in browser mode'],
  [
    '--browser.name <name>',
    'Browser to use: chromium, firefox, webkit (default: chromium)',
  ],
  ['--browser.headless', 'Run browser in headless mode (default: true in CI)'],
  ['--browser.port <port>', 'Port for the browser mode dev server'],
  ['--browser.strictPort', 'Exit if the specified port is already in use'],
  [
    '--unstubGlobals',
    'Restores all global variables that were changed with `rstest.stubGlobal` before every test',
  ],
  [
    '--unstubEnvs',
    'Restores all runtime env values that were changed with `rstest.stubEnv` before every test',
  ],
  [
    '--includeTaskLocation',
    'Collect test and suite locations. This might increase the running time.',
  ],
];

const poolOptionDefinitions: OptionDefinition[] = [
  ['--pool <type>', 'Shorthand for --pool.type'],
  ['--pool.type <type>', 'Specify the test pool type (forks | threads)'],
  [
    '--pool.maxWorkers <value>',
    'Maximum number or percentage of workers (e.g. 4 or 50%)',
  ],
  [
    '--pool.minWorkers <value>',
    'Minimum number or percentage of workers (e.g. 1 or 25%)',
  ],
  [
    '--pool.execArgv <arg>',
    'Additional Node.js execArgv passed to worker processes (can be specified multiple times)',
  ],
];

const mergeReportsOptionDefinitions: OptionDefinition[] = [
  [
    '-c, --config <config>',
    'Specify the configuration file, can be a relative or absolute path',
  ],
  [
    '--config-loader <loader>',
    'Specify the loader to load the config file (auto | jiti | native)',
    { default: 'auto' },
  ],
  [
    '-r, --root <root>',
    'Specify the project root directory, can be an absolute path or a path relative to cwd',
  ],
  ['--coverage', 'Enable code coverage collection'],
  ['--reporter <reporter>', 'Specify the reporter to use'],
  ['--cleanup', 'Remove blob reports directory after merging'],
];

const hiddenPassthroughOptionDefinitions: OptionDefinition[] = [
  ['--isolate', 'Run tests in an isolated environment'],
];

const listCommandOptionDefinitions: OptionDefinition[] = [
  ['--filesOnly', 'only list the test files'],
  ['--json [boolean/path]', 'print tests as JSON or write to a file'],
  ['--includeSuites', 'include suites in output'],
  ['--printLocation', 'print test case location'],
  ['--summary', 'print a summary after the list'],
];

const applyOptions = (
  command: CAC | Command,
  definitions: readonly OptionDefinition[],
): void => {
  for (const [rawName, description, config] of definitions) {
    command.option(rawName, description, config);
  }
};

const applyRuntimeCommandOptions = (command: Command): void => {
  applyOptions(command, runtimeOptionDefinitions);
  applyOptions(command, poolOptionDefinitions);
};

const normalizeCoverageCliArgs = (argv: string[]): string[] => {
  const hasCoverageNestedOption = argv.some((arg) =>
    arg.startsWith('--coverage.'),
  );

  if (!hasCoverageNestedOption) {
    return argv;
  }

  return argv.map((arg) => {
    if (arg === '--coverage') {
      return '--coverage.enabled';
    }
    if (arg.startsWith('--coverage=')) {
      return `--coverage.enabled=${arg.slice('--coverage='.length)}`;
    }
    if (arg === '--no-coverage') {
      return '--coverage.enabled=false';
    }

    return arg;
  });
};

const allowMixedCoverageCliOptions = (cli: CAC): void => {
  const originalParse = cli.parse.bind(cli);

  cli.parse = ((argv, options) =>
    originalParse(
      normalizeCoverageCliArgs(argv ?? process.argv),
      options,
    )) as CAC['parse'];
};

const filterHelpOptions = (
  sections: Array<{ title?: string; body: string }>,
  hiddenOptionPrefixes: string[],
) =>
  sections.map((section) => {
    if (section.title !== 'Options') {
      return section;
    }

    return {
      ...section,
      body: section.body
        .split('\n')
        .filter(
          (line) =>
            !hiddenOptionPrefixes.some((prefix) =>
              line.trimStart().startsWith(prefix),
            ),
        )
        .join('\n'),
    };
  });

const handleUnexpectedExit = (rstest: RstestInstance | undefined, err: any) => {
  for (const reporter of rstest?.context.reporters || []) {
    reporter.onExit?.();
  }
  logger.error('Failed to run Rstest.');
  logger.error(formatError(err));
  process.exit(1);
};

const resolveCliRuntime = async (options: CommonOptions) => {
  const [{ initCli }, { createRstest }] = await Promise.all([
    import('./init'),
    import('../core'),
  ]);
  const { config, configFilePath, projects } = await initCli(options);

  return {
    config,
    configFilePath,
    projects,
    createRstest,
  };
};

export const normalizeCliFilters = (
  filters: ReadonlyArray<string | number>,
): string[] => filters.map((filter) => normalize(String(filter)));

export const isRelatedRun = (options: CommonOptions): boolean =>
  options.related === true ||
  options.findRelatedTests === true ||
  options.changed !== undefined;

export const validateRelatedCliOptions = (options: CommonOptions): void => {
  const relatedOptionCount = [
    options.related === true,
    options.findRelatedTests === true,
    options.changed !== undefined,
  ].filter(Boolean).length;

  if (relatedOptionCount > 1) {
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
  const resolveGitRoot = async () => {
    const cdup = await runGit(['rev-parse', '--show-cdup']);

    return normalize(resolve(cwd, cdup.trim()));
  };
  const git = async (args: string[], gitRoot: string) => {
    const stdout = await runGit(args, gitRoot);

    return stdout
      .split('\0')
      .filter(Boolean)
      .map((file) => normalize(resolve(gitRoot, file)));
  };

  try {
    const gitRoot = await resolveGitRoot();
    const [committedFiles, stagedFiles, unstagedFiles] = await Promise.all([
      since
        ? git(
            [
              'diff',
              '--name-only',
              '-z',
              '--diff-filter=ACMRTUXB',
              `${since}...HEAD`,
            ],
            gitRoot,
          )
        : [],
      git(
        ['diff', '--name-only', '-z', '--cached', '--diff-filter=ACMRTUXB'],
        gitRoot,
      ),
      git(
        ['ls-files', '-z', '--others', '--modified', '--exclude-standard'],
        gitRoot,
      ),
    ]);

    return Array.from(
      new Set([...committedFiles, ...stagedFiles, ...unstagedFiles]),
    ).sort();
  } catch (error) {
    const reason = formatGitError(error);

    throw new Error(
      `Failed to resolve changed files for \`--changed\` from ${normalizedCwd}. Make sure the current root is inside a Git repository.${reason ? ` Git error: ${reason}` : ''}`,
      { cause: error },
    );
  }
};

const getCoverageChangedOption = (options: CommonOptions) => {
  if (options.coverage === undefined || typeof options.coverage === 'boolean') {
    return undefined;
  }

  return options.coverage.changed;
};

const resolveEffectiveCliFilters = async ({
  options,
  filters,
  createRstest,
  config,
  configFilePath,
  projects,
}: {
  options: CommonOptions;
  filters: Array<string | number>;
  createRstest: (
    input: {
      config: RstestConfig;
      configFilePath?: string;
      projects: Project[];
    },
    command: RstestCommand,
    fileFilters: string[],
  ) => RstestInstance;
  config: RstestConfig;
  configFilePath?: string;
  projects: Project[];
}): Promise<{
  effectiveFilters: string[];
  fileFilterMode: FileFilterMode;
  relatedFilters?: string[];
  relatedMode?: 'related' | 'changed';
  relatedResolutionEmpty?: boolean;
  changedCoverageFilters?: string[];
  relatedRerunReason?: 'forceRerunTrigger';
  relatedRerunFiles?: string[];
}> => {
  const normalizedFilters = normalizeCliFilters(filters);

  if (!isRelatedRun(options)) {
    return { effectiveFilters: normalizedFilters, fileFilterMode: 'fuzzy' };
  }

  validateRelatedCliOptions(options);

  if (options.changed !== undefined && normalizedFilters.length > 0) {
    throw new Error(
      'The `--changed` option cannot be used with positional filters.',
    );
  }

  const { resolveRelatedTestFiles } = await import('../core/related');
  const rstest = createRstest({ config, configFilePath, projects }, 'list', []);

  const sourceFilters =
    options.changed !== undefined
      ? await resolveChangedFiles(
          rstest.context.rootPath,
          typeof options.changed === 'string' ? options.changed : undefined,
        )
      : normalizedFilters;

  const forceRerunTriggerFiles =
    options.changed !== undefined
      ? getForceRerunTriggerFiles({
          changedFiles: sourceFilters,
          triggers: getForceRerunTriggers({
            rootTriggers: rstest.context.normalizedConfig.forceRerunTriggers,
            projects: rstest.context.projects,
          }),
          rootPath: rstest.context.rootPath,
        })
      : [];

  if (forceRerunTriggerFiles.length) {
    return {
      effectiveFilters: [],
      fileFilterMode: 'fuzzy',
      relatedFilters: sourceFilters,
      relatedMode: 'changed',
      relatedResolutionEmpty: false,
      relatedRerunReason: 'forceRerunTrigger',
      relatedRerunFiles: forceRerunTriggerFiles.map((file) =>
        normalize(relative(rstest.context.rootPath, file)),
      ),
    };
  }

  const relatedFiles = await resolveRelatedTestFiles(rstest.context, {
    sourceFilters,
    filterLabel: options.changed !== undefined ? '--changed' : '--related',
    allowEmpty: options.changed !== undefined,
  });
  const coverageChanged = getCoverageChangedOption(options);

  return {
    effectiveFilters: relatedFiles,
    fileFilterMode: 'exact',
    relatedFilters: sourceFilters,
    relatedMode: options.changed !== undefined ? 'changed' : 'related',
    relatedResolutionEmpty: relatedFiles.length === 0,
    changedCoverageFilters:
      options.changed !== undefined && coverageChanged === undefined
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

export const runRest = async ({
  options,
  filters,
  command,
}: {
  options: CommonOptions;
  filters: Array<string | number>;
  command: RstestCommand;
}): Promise<void> => {
  let rstest: RstestInstance | undefined;
  const unexpectedlyExitHandler = (err: any) => {
    handleUnexpectedExit(rstest, err);
  };

  try {
    const { config, configFilePath, projects, createRstest } =
      await resolveCliRuntime(options);
    const {
      effectiveFilters,
      fileFilterMode,
      relatedFilters,
      relatedMode,
      relatedResolutionEmpty,
      changedCoverageFilters,
      relatedRerunReason,
      relatedRerunFiles,
    } = await resolveEffectiveCliFilters({
      options,
      filters,
      createRstest,
      config,
      configFilePath,
      projects,
    });

    rstest = createRstest(
      { config, configFilePath, projects, trace: options.trace },
      command,
      effectiveFilters,
      fileFilterMode,
    );
    rstest.context.relatedFilters = relatedFilters;
    rstest.context.relatedMode = relatedMode;
    rstest.context.relatedResolutionEmpty = relatedResolutionEmpty;
    rstest.context.changedCoverageFilters = changedCoverageFilters;
    rstest.context.changedCoverageFilters =
      await resolveCoverageChangedFilters(rstest);
    rstest.context.relatedRerunReason = relatedRerunReason;
    rstest.context.relatedRerunFiles = relatedRerunFiles;
    rstest.context.relatedRerunReason = relatedRerunReason;
    rstest.context.relatedRerunFiles = relatedRerunFiles;

    process.on('uncaughtException', unexpectedlyExitHandler);

    process.on('unhandledRejection', unexpectedlyExitHandler);

    if (command === 'watch') {
      const { watchFilesForRestart, onBeforeRestart } =
        await import('../core/restart');

      onBeforeRestart(() => {
        process.off('uncaughtException', unexpectedlyExitHandler);
        process.off('unhandledRejection', unexpectedlyExitHandler);
      });

      watchFilesForRestart({
        rstest,
        options,
        filters,
      });
    }

    await rstest.runTests();
  } catch (err) {
    handleUnexpectedExit(rstest, err);
  }
};

const normalizeCoverageArgv = (argv: string[]): string[] => {
  const normalized: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (!arg) continue;

    if (arg === '--coverage') {
      normalized.push('--coverage.enabled');
      continue;
    }

    if (arg === '--no-coverage') {
      normalized.push('--coverage.enabled=false');
      continue;
    }

    normalized.push(arg);
  }

  return normalized;
};

export function createCli(): CAC {
  const cli = cac('rstest');

  cli.help((sections) => {
    switch (cli.matchedCommand?.name) {
      case 'init':
      case 'merge-reports':
        return filterHelpOptions(sections, ['--isolate']);
      default:
        return sections;
    }
  });
  cli.version(RSTEST_VERSION);

  const defaultCommand = cli
    .command('[...filters]', 'run tests')
    .option('-w, --watch', 'Run tests in watch mode');
  applyRuntimeCommandOptions(defaultCommand);
  defaultCommand.action(
    async (
      filters: string[],
      options: CommonOptions & {
        watch?: boolean;
      },
    ) => {
      if (!determineAgent().isAgent) {
        showRstest();
      }
      if (options.watch) {
        await runRest({ options, filters, command: 'watch' });
      } else {
        await runRest({ options, filters, command: 'run' });
      }
    },
  );

  const runCommand = cli.command(
    'run [...filters]',
    'run tests without watch mode',
  );
  applyRuntimeCommandOptions(runCommand);
  runCommand.action(async (filters: string[], options: CommonOptions) => {
    if (!determineAgent().isAgent) {
      showRstest();
    }
    await runRest({ options, filters, command: 'run' });
  });

  const watchCommand = cli.command(
    'watch [...filters]',
    'run tests in watch mode',
  );
  applyRuntimeCommandOptions(watchCommand);
  watchCommand.action(async (filters: string[], options: CommonOptions) => {
    if (!determineAgent().isAgent) {
      showRstest();
    }
    await runRest({ options, filters, command: 'watch' });
  });

  const listCommand = cli.command(
    'list [...filters]',
    'lists all test files that Rstest will run',
  );
  applyRuntimeCommandOptions(listCommand);
  applyOptions(listCommand, listCommandOptionDefinitions);
  listCommand.action(
    async (filters: string[], options: CommonOptions & ListCommandOptions) => {
      try {
        const { config, configFilePath, projects, createRstest } =
          await resolveCliRuntime(options);

        if (options.printLocation) {
          config.includeTaskLocation = true;
        }

        const {
          effectiveFilters,
          fileFilterMode,
          relatedFilters,
          relatedMode,
          relatedResolutionEmpty,
          changedCoverageFilters,
          relatedRerunReason,
          relatedRerunFiles,
        } = await resolveEffectiveCliFilters({
          options,
          filters,
          createRstest,
          config,
          configFilePath,
          projects,
        });

        const rstest = createRstest(
          { config, configFilePath, projects },
          'list',
          effectiveFilters,
          fileFilterMode,
        );
        rstest.context.relatedFilters = relatedFilters;
        rstest.context.relatedMode = relatedMode;
        rstest.context.relatedResolutionEmpty = relatedResolutionEmpty;
        rstest.context.changedCoverageFilters = changedCoverageFilters;
        rstest.context.changedCoverageFilters =
          await resolveCoverageChangedFilters(rstest);
        rstest.context.relatedRerunReason = relatedRerunReason;
        rstest.context.relatedRerunFiles = relatedRerunFiles;
        rstest.context.relatedRerunReason = relatedRerunReason;
        rstest.context.relatedRerunFiles = relatedRerunFiles;

        await rstest.listTests({
          filesOnly: options.filesOnly,
          json: options.json,
          includeSuites: options.includeSuites,
          printLocation: options.printLocation,
          summary: options.summary,
        });
      } catch (err) {
        logger.error('Failed to run Rstest list.');
        logger.error(formatError(err));
        process.exit(1);
      }
    },
  );

  const mergeReportsCommand = cli.command(
    'merge-reports [path]',
    'Merge blob reports from multiple shards into a unified report',
  );
  applyOptions(mergeReportsCommand, mergeReportsOptionDefinitions);
  applyOptions(mergeReportsCommand, hiddenPassthroughOptionDefinitions);
  mergeReportsCommand.action(
    async (
      path: string | undefined,
      options: CommonOptions & { cleanup?: boolean },
    ) => {
      if (!determineAgent().isAgent) {
        showRstest();
      }
      try {
        const { config, configFilePath, projects, createRstest } =
          await resolveCliRuntime(options);
        const rstest = createRstest(
          { config, configFilePath, projects },
          'merge-reports',
          [],
        );

        await rstest.mergeReports({ path, cleanup: options.cleanup });
      } catch (err) {
        logger.error('Failed to merge reports.');
        logger.error(formatError(err));
        process.exit(1);
      }
    },
  );

  // init command - initialize rstest configuration
  cli
    .command('init [project]', 'Initialize rstest configuration')
    .option('--yes', 'Use default options (non-interactive)')
    .option('--isolate', 'Run tests in an isolated environment')
    .action(async (project: string | undefined, options: { yes?: boolean }) => {
      try {
        let selectedProject = project;

        // If no project specified, show selection menu
        if (!selectedProject) {
          const { select, isCancel } = await import('@clack/prompts');

          console.log();
          const selected = await select({
            message: 'What would you like to initialize?',
            options: [
              {
                value: 'browser',
                label: 'browser',
                hint: 'Browser mode for component testing',
              },
            ],
          });

          if (isCancel(selected)) {
            console.log(color.yellow('Operation cancelled.'));
            process.exit(0);
          }

          selectedProject = selected as string;
        }

        if (selectedProject === 'browser') {
          const { create } = await import('./init/browser');
          await create({ yes: options.yes });
        } else {
          logger.error(
            `Unknown project type: "${selectedProject}". Available: browser`,
          );
          process.exit(1);
        }
      } catch (err) {
        logger.error('Failed to initialize rstest.');
        logger.error(formatError(err));
        process.exit(1);
      }
    });

  allowMixedCoverageCliOptions(cli);

  return cli;
}

export function setupCommands(): void {
  const cli = createCli();
  const normalizedArgv = normalizeCoverageArgv(process.argv);

  cli.parse(normalizedArgv);
}
