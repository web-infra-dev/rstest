import type { LoadConfigOptions } from '@rsbuild/core';
import cac, { type CAC } from 'cac';
import { loadConfig } from '../config';
import type { RstestConfig } from '../types';
import { getAbsolutePath } from '../utils/helper';
import { logger } from '../utils/logger';

type CommonOptions = {
  root?: string;
  config?: string;
  configLoader?: LoadConfigOptions['loader'];
};

const applyCommonOptions = (cli: CAC) => {
  cli
    .option(
      '-c, --config <config>',
      'specify the configuration file, can be a relative or absolute path',
    )
    .option(
      '--config-loader <loader>',
      'specify the loader to load the config file, can be `jiti` or `native`',
      {
        default: 'jiti',
      },
    )
    .option(
      '-r, --root <root>',
      'specify the project root directory, can be an absolute path or a path relative to cwd',
    );
};

export async function init(options: CommonOptions): Promise<{
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

  if (options.root) {
    config.root = root;
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
    .command('run [...filters]', 'run Rstest without watch mode')
    .action(async (options: CommonOptions) => {
      try {
        const { config } = await init(options);
        const { createRstest } = await import('../core');
        const rstest = createRstest(config);
        await rstest.runTests();
      } catch (err) {
        logger.error('Failed to run Rstest.');
        logger.error(err);
        process.exit(1);
      }
    });

  cli
    .command('watch [...filters]', 'run Rstest in watch mode')
    .action(async (options: CommonOptions) => {
      await init(options);
      console.log('run Rstest in watch mode');
    });

  cli.parse();
}
