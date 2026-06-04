import type { TestRunResult } from '../api/result';
import { logger } from '../utils/logger';
import { setupCommands } from './commands';
import { prepareCli } from './prepare';

export { initCli } from './init';

/**
 * Run the Rstest CLI from an argv. The single CLI entry — used by the `rstest`
 * bin and exported from `@rstest/core/api` for jest-compatible programmatic use.
 *
 * Resolves to a structured {@link TestRunResult} when the matched command runs
 * tests (`run` / default / `watch`); resolves to `undefined` for `list` /
 * `merge-reports` / `init`. Like the CLI, it may call `process.exit` on fatal
 * errors — for host-safe in-process runs that never exit, use `createRstest`.
 *
 * @experimental Subject to change until 1.0.0.
 */
export async function runCli(
  options: { argv?: string[]; cwd?: string } = {},
): Promise<TestRunResult | undefined> {
  prepareCli();

  try {
    return await setupCommands(options.argv ?? process.argv, options.cwd);
  } catch (err) {
    logger.error('Failed to start Rstest CLI.');
    logger.error(err);
    process.exit(1);
  }
}
