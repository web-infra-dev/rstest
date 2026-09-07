import { logger } from '../utils/logger';
import { setupCommands } from './commands';
import { prepareCli } from './prepare';

/** @experimental Subject to change until 1.0.0. */
export type RunCLIOptions = {
  /**
   * The command-line arguments to parse, matching the shape of Node.js `process.argv`
   * @default process.argv
   */
  argv?: string[];
};

/** @experimental Subject to change until 1.0.0. */
export function runCLI({ argv = process.argv }: RunCLIOptions = {}): void {
  prepareCli();

  try {
    setupCommands(argv);
  } catch (err) {
    logger.error('Failed to start Rstest CLI.');
    logger.error(err);
    process.exit(1);
  }
}
