import cac, { type CAC } from 'cac';
import { normalize } from 'pathe';
import type {
  ListCommandOptions,
  RstestCommand,
  RstestInstance,
} from '../types';
import { color, determineAgent, formatError, logger } from '../utils';
import type { CommonOptions } from './init';
import { showRstest } from './prepare';

export type { CommonOptions } from './init';

const applyCommonOptions = (cli: CAC) => {
  cli
    .option(
      '-c, --config <config>',
      'Specify the configuration file, can be a relative or absolute path',
    )
    .option(
      '--config-loader <loader>',
      'Specify the loader to load the config file, can be `jiti` or `native`',
      {
        default: 'jiti',
      },
    )
    .option(
      '-r, --root <root>',
      'Specify the project root directory, can be an absolute path or a path relative to cwd',
    )
    .option('--globals', 'Provide global APIs')
    .option('--isolate', 'Run tests in an isolated environment')
    .option('--include <include>', 'Match test files')
    .option('--exclude <exclude>', 'Exclude files from test')
    .option('-u, --update', 'Update snapshot files')
    .option('--coverage', 'Enable code coverage collection')
    .option(
      '--project <name>',
      'Run only projects that match the name, can be a full name or wildcards pattern',
    )
    .option(
      '--passWithNoTests',
      'Allows the test suite to pass when no files are found',
    )
    .option(
      '--printConsoleTrace',
      'Print console traces when calling any console method',
    )
    .option('--disableConsoleIntercept', 'Disable console intercept')
    .option('--logHeapUsage', 'Log heap usage after each test')
    .option(
      '--slowTestThreshold <value>',
      'The number of milliseconds after which a test or suite is considered slow',
    )
    .option('--reporter <reporter>', 'Specify the reporter to use')
    .option(
      '-t, --testNamePattern <value>',
      'Run only tests with a name that matches the regex',
    )
    .option(
      '--testEnvironment <name>',
      'The environment that will be used for testing',
    )
    .option('--testTimeout <value>', 'Timeout of a test in milliseconds')
    .option('--hookTimeout <value>', 'Timeout of hook in milliseconds')
    .option('--hideSkippedTests', 'Hide skipped tests from the output')
    .option('--hideSkippedTestFiles', 'Hide skipped test files from the output')
    .option('--retry <retry>', 'Number of times to retry a test if it fails')
    .option(
      '--bail [number]',
      'Stop running tests after n failures. Set to 0 to run all tests regardless of failures',
    )
    .option('--maxConcurrency <value>', 'Maximum number of concurrent tests')
    .option(
      '--clearMocks',
      'Automatically clear mock calls, instances, contexts and results before every test',
    )
    .option('--resetMocks', 'Automatically reset mock state before every test')
    .option(
      '--restoreMocks',
      'Automatically restore mock state and implementation before every test',
    )
    .option('--browser', 'Run tests in browser mode')
    .option('--browser.enabled', 'Run tests in browser mode')
    .option(
      '--browser.name <name>',
      'Browser to use: chromium, firefox, webkit (default: chromium)',
    )
    .option(
      '--browser.headless',
      'Run browser in headless mode (default: true in CI)',
    )
    .option('--browser.port <port>', 'Port for the browser mode dev server')
    .option(
      '--browser.strictPort',
      'Exit if the specified port is already in use',
    )
    .option(
      '--unstubGlobals',
      'Restores all global variables that were changed with `rstest.stubGlobal` before every test',
    )
    .option(
      '--unstubEnvs',
      'Restores all `process.env` values that were changed with `rstest.stubEnv` before every test',
    )
    .option(
      '--includeTaskLocation',
      'Collect test and suite locations. This might increase the running time.',
    );

  cli
    .option('--pool <type>', 'Shorthand for --pool.type')
    .option('--pool.type <type>', 'Specify the test pool type (e.g. forks)')
    .option(
      '--pool.maxWorkers <value>',
      'Maximum number or percentage of workers (e.g. 4 or 50%)',
    )
    .option(
      '--pool.minWorkers <value>',
      'Minimum number or percentage of workers (e.g. 1 or 25%)',
    )
    .option(
      '--pool.execArgv <arg>',
      'Additional Node.js execArgv passed to worker processes (can be specified multiple times)',
    );
};

const handleUnexpectedExit = (rstest: RstestInstance | undefined, err: any) => {
  for (const reporter of rstest?.context.reporters || []) {
    reporter.onExit?.();
  }
  logger.error('Failed to run Rstest.');
  logger.error(formatError(err));
  process.exit(1);
};

export const runRest = async ({
  options,
  filters,
  command,
}: {
  options: CommonOptions;
  filters: string[];
  command: RstestCommand;
}): Promise<void> => {
  let rstest: RstestInstance | undefined;
  const unexpectedlyExitHandler = (err: any) => {
    handleUnexpectedExit(rstest, err);
  };

  try {
    const { initCli } = await import('./init');
    const { config, configFilePath, projects } = await initCli(options);
    const { createRstest } = await import('../core');
    rstest = createRstest(
      { config, configFilePath, projects },
      command,
      filters.map(normalize),
    );

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

export function setupCommands(): void {
  const cli = cac('rstest');

  cli.help();
  cli.version(RSTEST_VERSION);

  // Apply common options to all commands
  applyCommonOptions(cli);

  cli
    .command('[...filters]', 'run tests')
    .option('-w, --watch', 'Run tests in watch mode')
    .action(
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

  cli
    .command('run [...filters]', 'run tests without watch mode')
    .action(async (filters: string[], options: CommonOptions) => {
      if (!determineAgent().isAgent) {
        showRstest();
      }
      await runRest({ options, filters, command: 'run' });
    });

  cli
    .command('watch [...filters]', 'run tests in watch mode')
    .action(async (filters: string[], options: CommonOptions) => {
      if (!determineAgent().isAgent) {
        showRstest();
      }
      await runRest({ options, filters, command: 'watch' });
    });

  cli
    .command('list [...filters]', 'lists all test files that Rstest will run')
    .option('--filesOnly', 'only list the test files')
    .option('--json [boolean/path]', 'print tests as JSON or write to a file')
    .option('--includeSuites', 'include suites in output')
    .option('--printLocation', 'print test case location')
    .action(
      async (
        filters: string[],
        options: CommonOptions & ListCommandOptions,
      ) => {
        try {
          const { initCli } = await import('./init');
          const { config, configFilePath, projects } = await initCli(options);

          if (options.printLocation) {
            config.includeTaskLocation = true;
          }

          const { createRstest } = await import('../core');
          const rstest = createRstest(
            { config, configFilePath, projects },
            'list',
            filters.map(normalize),
          );

          await rstest.listTests({
            filesOnly: options.filesOnly,
            json: options.json,
            includeSuites: options.includeSuites,
            printLocation: options.printLocation,
          });
        } catch (err) {
          logger.error('Failed to run Rstest list.');
          logger.error(formatError(err));
          process.exit(1);
        }
      },
    );

  // init command - initialize rstest configuration
  cli
    .command('init [project]', 'Initialize rstest configuration')
    .option('--yes', 'Use default options (non-interactive)')
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

  cli.parse();
}
