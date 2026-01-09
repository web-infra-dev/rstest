import { logger } from '../utils/logger';
import { setupCommands } from './commands';
import { prepareCli } from './prepare';

export { initCli } from './init';

export async function runCLI(): Promise<void> {
  // make it easier to identify the process via activity monitor or other tools
  process.title = 'rstest-node';

  prepareCli();

  try {
    setupCommands();
  } catch (err) {
    logger.error('Failed to start Rstest CLI.');
    logger.error(err);
  }
}
