import { logger } from '../utils/logger';
import { setupCommands } from './commands';
import { prepareCli } from './prepare';
import { maybeHandleProfileShortcut } from './profile';

export { initCli } from './init';

export function runCLI(): void {
  // make it easier to identify the process via activity monitor or other tools
  process.title = 'rstest-node';

  if (maybeHandleProfileShortcut()) {
    return;
  }

  prepareCli();

  try {
    setupCommands();
  } catch (err) {
    logger.error('Failed to start Rstest CLI.');
    logger.error(err);
    process.exit(1);
  }
}
