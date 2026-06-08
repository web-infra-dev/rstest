import { logger } from '../utils/logger';
import { setupCommands } from './commands';
import { prepareCli } from './prepare';

export { initCli } from './init';

/**
 * Internal entry for the `rstest` bin: parse a raw `process.argv`-shaped string
 * array, route it to the matched command (run/watch/list/merge-reports/init),
 * and run it to completion. Owns the CLI process — shows the banner and may call
 * `process.exit` on fatal errors.
 *
 * This is the raw-argv layer (analogous to jest-cli's `run`); the public,
 * parsed-object, host-safe entry that returns a structured result is `runCli`
 * in `@rstest/core/api` (analogous to `@jest/core`'s `runCLI`). `startCli` is
 * re-exported `@internal` from `/api` only so the bin can load it from the
 * single `api/index` build output.
 */
export async function startCli(
  options: { argv?: string[]; cwd?: string } = {},
): Promise<void> {
  prepareCli();

  try {
    await setupCommands(options.argv ?? process.argv, options.cwd);
  } catch (err) {
    logger.error('Failed to start Rstest CLI.');
    logger.error(err);
    process.exit(1);
  }
}
