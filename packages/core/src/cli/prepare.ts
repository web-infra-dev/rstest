import { applyTestEnvMarkers } from '../utils/env';
import { logger } from '../utils/logger';

/**
 * Mark the host process as running Rstest, so anything evaluated here — the
 * user's config factory, Rsbuild's `loadConfig`, browserslist — sees the same
 * markers the tests themselves run under. Both entry points call it: the CLI
 * (`prepareCli`, including the `runCLI` bridge) and the in-process API.
 */
export function initRstestEnv(): void {
  applyTestEnvMarkers(process.env);
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
