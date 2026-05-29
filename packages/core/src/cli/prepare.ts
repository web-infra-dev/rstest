import { logger } from '../utils/logger';

function initNodeEnv() {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
}

/**
 * Initialize the test environment variables that worker processes inherit via
 * `process.env`. Shared by the CLI (`prepareCli`) and the programmatic API
 * (`runRstest`) so both paths run tests with `NODE_ENV=test` and `RSTEST=true`.
 */
export function initRstestEnv(): void {
  initNodeEnv();
  process.env.RSTEST = 'true';
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
