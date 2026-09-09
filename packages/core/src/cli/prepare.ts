import { ENV } from '../utils/env';
import { logger } from '../utils/logger';

function initNodeEnv() {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
}

/**
 * Initialize the test environment variables that worker processes inherit via
 * `process.env`. Shared by the CLI (`prepareCli`) and the programmatic API
 * (`createRstest`). Both paths always set `RSTEST=true` and default `NODE_ENV`
 * to `test` only when unset. Neither process-level assignment is snapshotted
 * or restored.
 */
export function initRstestEnv(): void {
  initNodeEnv();
  process.env[ENV.RSTEST] = 'true';
}

export function prepareCli(): void {
  initRstestEnv();

  // Print a blank line to keep the greet log nice.
  // Some package managers automatically output a blank line, some do not.
  const { npm_execpath } = process.env;
  if (
    !npm_execpath ||
    npm_execpath.includes('npx-cli.js') ||
    npm_execpath.includes('.bun')
  ) {
    logger.log();
  }
}

export function showRstest(): void {
  logger.greet(`  Rstest v${RSTEST_VERSION}`);
  logger.log('');
}
