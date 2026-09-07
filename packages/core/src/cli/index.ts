import { logger } from '../utils/logger';
import { setupCommands } from './commands';
import { prepareCli } from './prepare';

/** @experimental Subject to change until 1.0.0. */
export type RunCLIOptions = {
  /**
   * The command, filters, and flags to parse, exactly as written after `rstest`
   * on the command line.
   * @default process.argv.slice(2)
   */
  argv?: string[];
};

/** @experimental Subject to change until 1.0.0. */
export function runCLI({
  argv = process.argv.slice(2),
}: RunCLIOptions = {}): void {
  prepareCli();

  try {
    setupCommands(['node', 'rstest', ...argv]);
  } catch (err) {
    logger.error('Failed to start Rstest CLI.');
    logger.error(err);
    process.exit(1);
  }
}
