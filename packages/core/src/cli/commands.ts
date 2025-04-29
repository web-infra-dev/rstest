import type { LoadConfigOptions } from '@rsbuild/core';
import cac, { type CAC } from 'cac';
import { normalize } from 'pathe';
import { isCI } from 'std-env';
import { loadConfig } from '../config';
import type { RstestConfig } from '../types';
import { formatError, getAbsolutePath } from '../utils/helper';
import { logger } from '../utils/logger';

type CommonOptions = {
  root?: string;
  config?: string;
  configLoader?: LoadConfigOptions['loader'];
  globals?: boolean;
  passWithNoTests?: boolean;
  update?: boolean;
  testNamePattern?: RegExp | string;
  testTimeout?: number;
  clearMocks?: boolean;
  resetMocks?: boolean;
  restoreMocks?: boolean;
  unstubGlobals?: boolean;
  unstubEnvs?: boolean;
  retry?: number;
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
    .option('-u, --update', 'Update snapshot files')
    .option(
      '--passWithNoTests',
      'Allows the test suite to pass when no files are found.',
    )
    .option(
      '-t, --testNamePattern <testNamePattern>',
      'Run only tests with a name that matches the regex.',
    )
    .option('--testTimeout <testTimeout>', 'Timeout of a test in milliseconds')
    .option('--retry <retry>', 'Number of times to retry a test if it fails.')
    .option(
      '--clearMocks',
      'Automatically clear mock calls, instances, contexts and results before every test.',
    )
    .option('--resetMocks', 'Automatically reset mock state before every test.')
    .option(
      '--restoreMocks',
      'Automatically restore mock state and implementation before every test.',
    )
    .option(
      '--unstubGlobals',
      'Restores all global variables that were changed with `rstest.stubGlobal` before every test.',
    )
    .option(
      '--unstubEnvs',
      'Restores all `process.env` values that were changed with `rstest.stubEnv` before every test.',
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
  ];
  for (const key of keys) {
    if (options[key] !== undefined) {
      (config[key] as any) = options[key];
    }
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
    .command('run [...filters]', 'run tests in CI mode')
    .action(async (filters: string[], options: CommonOptions) => {
      try {
        const { config } = await initCli(options);
        const { createRstest } = await import('../core');
        const rstest = createRstest(config, 'run', filters.map(normalize));
        await rstest.runTests();
      } catch (err) {
        logger.error('Failed to run Rstest.');
        logger.error(formatError(err));
        process.exit(1);
      }
    });

  cli
    .command('watch [...filters]', 'run tests in watch mode')
    .action(async (filters: string[], options: CommonOptions) => {
      const { config } = await initCli(options);
      const { createRstest } = await import('../core');
      const rstest = createRstest(config, 'watch', filters.map(normalize));
      await rstest.runTests();
    });

  cli.parse();
}
