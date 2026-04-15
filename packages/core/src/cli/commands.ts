import cac, { type CAC, type Command } from 'cac';
import { normalize } from 'pathe';
import type {
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
  ['--globals', 'Provide global APIs'],
  ['--isolate', 'Run tests in an isolated environment'],
  ['--include <include>', 'Match test files'],
  ['--exclude <exclude>', 'Exclude files from test'],
  ['-u, --update', 'Update snapshot files'],
  ['--coverage', 'Enable code coverage collection'],
  [
    '--project <name>',
    'Run only projects that match the name, can be a full name or wildcards pattern',
  ],
  [
    '--passWithNoTests',
    'Allows the test suite to pass when no files are found',
  ],
  [
    '--printConsoleTrace',
    'Print console traces when calling any console method',
  ],
  ['--disableConsoleIntercept', 'Disable console intercept'],
  ['--logHeapUsage', 'Log heap usage after each test'],
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
  ['--pool.type <type>', 'Specify the test pool type (e.g. forks)'],
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

const isRelatedRun = (options: CommonOptions): boolean =>
  options.related === true || options.findRelatedTests === true;

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
  relatedFilters?: string[];
}> => {
  const normalizedFilters = normalizeCliFilters(filters);

  if (!isRelatedRun(options)) {
    return { effectiveFilters: normalizedFilters };
  }

  const { resolveRelatedTestFiles } = await import('../core/related');
  const rstest = createRstest({ config, configFilePath, projects }, 'list', []);

  const relatedFiles = await resolveRelatedTestFiles(
    rstest.context,
    normalizedFilters,
  );

  return {
    effectiveFilters:
      relatedFiles.length > 0 ? relatedFiles : normalizedFilters,
    relatedFilters: normalizedFilters,
  };
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
    const { effectiveFilters, relatedFilters } =
      await resolveEffectiveCliFilters({
        options,
        filters,
        createRstest,
        config,
        configFilePath,
        projects,
      });

    rstest = createRstest(
      { config, configFilePath, projects },
      command,
      effectiveFilters,
    );
    rstest.context.relatedFilters = relatedFilters;

    process.on('uncaughtException', unexpectedlyExitHandler);

    process.on('unhandledRejection', unexpectedlyExitHandler);

    if (command === 'watch') {
      const { watchFilesForRestart, onBeforeRestart } = await import(
        '../core/restart'
      );

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

        const { effectiveFilters, relatedFilters } =
          await resolveEffectiveCliFilters({
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
        );
        rstest.context.relatedFilters = relatedFilters;

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

  return cli;
}

export function setupCommands(): void {
  createCli().parse();
}
