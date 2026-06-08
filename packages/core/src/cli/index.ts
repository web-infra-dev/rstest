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
 * in `@rstest/core/api` (analogous to `@jest/core`'s `runCLI`). This module is
 * built as its own `dist/cli.js` chunk and loaded by the `rstest` bin directly;
 * it is intentionally NOT a `package.json` export, so `startCli` never reaches
 * the public surface (mirrors vitest's `dist/cli.js`).
 *
 * @internal
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
