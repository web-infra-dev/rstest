import type { LoadConfigOptions } from '@rsbuild/core';
import cac, { type CAC } from 'cac';
import { normalize } from 'pathe';
import { isCI } from 'std-env';
import { loadConfig } from '../config';
import type { ListCommandOptions, RstestConfig } from '../types';
import { castArray, formatError, getAbsolutePath } from '../utils/helper';
import { logger } from '../utils/logger';
import { showRstest } from './prepare';

type CommonOptions = {
  root?: string;
  config?: string;
  configLoader?: LoadConfigOptions['loader'];
  globals?: boolean;
  isolate?: boolean;
  exclude?: string[];
  passWithNoTests?: boolean;
  printConsoleTrace?: boolean;
  disableConsoleIntercept?: boolean;
  update?: boolean;
  testNamePattern?: RegExp | string;
  testTimeout?: number;
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
    .option('--exclude <exclude>', 'Exclude files from test')
    .option('-u, --update', 'Update snapshot files')
    .option(
      '--passWithNoTests',
      'Allows the test suite to pass when no files are found',
    )
    .option(
      '--printConsoleTrace',
      'Print console traces when calling any console method',
    )
    .option('--disableConsoleIntercept', 'Disable console intercept')
    .option(
      '--slowTestThreshold <value>',
      'The number of milliseconds after which a test or suite is considered slow',
    )
    .option(
      '-t, --testNamePattern <value>',
      'Run only tests with a name that matches the regex',
    )
    .option(
      '--testEnvironment <name>',
      'The environment that will be used for testing',
    )
    .option('--testTimeout <value>', 'Timeout of a test in milliseconds')
    .option('--retry <retry>', 'Number of times to retry a test if it fails')
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
    .option(
      '--unstubGlobals',
      'Restores all global variables that were changed with `rstest.stubGlobal` before every test',
    )
    .option(
      '--unstubEnvs',
      'Restores all `process.env` values that were changed with `rstest.stubEnv` before every test',
    );
};

export async function initCli(options: CommonOptions): Promise<{
  config: RstestConfig;
  configFilePath: string | null;
}> {
  const cwd = process.cwd();
  const root = options.root ? getAbsolutePath(cwd, options.root) : cwd;

  const { content: config, filePath: configFilePath } = await loadConfig({
    cwd: root,
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

  return {
    config,
    configFilePath,
  };
}

export function setupCommands(): void {
  const cli = cac('rstest');

  cli.help();
  cli.version(RSTEST_VERSION);

  // Apply common options to all commands
  applyCommonOptions(cli);

  cli
    .command('[...filters]', 'run tests')
    .action(async (filters: string[], options: CommonOptions) => {
      showRstest();
      try {
        const { config } = await initCli(options);
        const { createRstest } = await import('../core');
        if (isCI) {
          const rstest = createRstest(config, 'run', filters.map(normalize));
          await rstest.runTests();
        } else {
          const rstest = createRstest(config, 'watch', filters.map(normalize));
          await rstest.runTests();
        }
      } catch (err) {
        logger.error('Failed to run Rstest.');
        logger.error(err);
        process.exit(1);
      }
    });

  cli
    .command('run [...filters]', 'run tests without watch mode')
    .action(async (filters: string[], options: CommonOptions) => {
      showRstest();
      const { config } = await initCli(options);
      const { createRstest } = await import('../core');
      const rstest = createRstest(config, 'run', filters.map(normalize));
      try {
        await rstest.runTests();
      } catch (err) {
        for (const reporter of rstest.context.reporters) {
          reporter.onExit?.();
        }
        logger.error('Failed to run Rstest.');
        logger.error(formatError(err));
        process.exit(1);
      }
    });

  cli
    .command('watch [...filters]', 'run tests in watch mode')
    .action(async (filters: string[], options: CommonOptions) => {
      showRstest();
      const { config } = await initCli(options);
      const { createRstest } = await import('../core');
      const rstest = createRstest(config, 'watch', filters.map(normalize));
      await rstest.runTests();
    });

  cli
    .command('list [...filters]', 'lists all test files that Rstest will run')
    .option('--filesOnly', 'only list the test files')
    .option('--json [boolean/path]', 'print tests as JSON or write to a file')
    .action(
      async (
        filters: string[],
        options: CommonOptions & ListCommandOptions,
      ) => {
        try {
          const { config } = await initCli(options);
          const { createRstest } = await import('../core');
          const rstest = createRstest(config, 'list', filters.map(normalize));
          await rstest.listTests({
            filesOnly: options.filesOnly,
            json: options.json,
          });
        } catch (err) {
          logger.error('Failed to run Rstest list.');
          logger.error(formatError(err));
          process.exit(1);
        }
      },
    );

  cli.parse();
}
