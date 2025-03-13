import { logger } from '../utils/logger';

function initNodeEnv() {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
}

export function prepareCli(): void {
  initNodeEnv();

  // Print a blank line to keep the greet log nice.
  // Some package managers automatically output a blank line, some do not.
  const { npm_execpath } = process.env;
  if (
    !npm_execpath ||
    npm_execpath.includes('npx-cli.js') ||
    npm_execpath.includes('.bun')
  ) {
    console.log();
  }

  logger.greet(`  ${`Rstest v${RSTEST_VERSION}`}\n`);
  logger.log(`  ${`Rstest v${RSTEST_VERSION}`}`);
}
