import { logger } from '../utils/logger';
import { setupCommands } from './commands';
import { prepareCli } from './prepare';

/**
 * Options for {@link runCLI}.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface RunCLIOptions {
  /**
   * CLI arguments to parse, matching the shape of Node.js `process.argv`
   * (i.e. including the leading `node` / bin entries).
   *
   * @default process.argv
   */
  argv?: string[];

  /**
   * Working directory to resolve the config file and test files from.
   *
   * @default process.cwd()
   */
  cwd?: string;
}

/**
 * Run the Rstest CLI programmatically: parse a raw `process.argv`-shaped `argv`,
 * route it to the matched command (run/watch/list/merge-reports/init), and run
 * it to completion. This is the same entry the `rstest` bin uses, so it mirrors
 * the CLI exactly — it auto-discovers the config file from `cwd`, prints the
 * banner, sets the exit code, and **owns the process** (may call `process.exit`
 * on fatal errors).
 *
 * Built for CLI bridges — e.g. a unified `rs` CLI forwarding a reconstructed
 * `argv` to Rstest — mirroring rsbuild's `runCLI`. For host-safe, in-process
 * runs that return a structured {@link import('../api').TestRunResult} instead
 * of owning the process, use {@link import('../api').createRstest}.
 *
 * @experimental Subject to change until 1.0.0.
 */
export async function runCLI(options: RunCLIOptions = {}): Promise<void> {
  prepareCli();

  try {
    await setupCommands(options.argv ?? process.argv, options.cwd);
  } catch (err) {
    logger.error('Failed to start Rstest CLI.');
    logger.error(err);
    process.exit(1);
  }
}
