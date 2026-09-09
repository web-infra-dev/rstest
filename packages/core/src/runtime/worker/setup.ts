/**
 * Install a graceful SIGTERM handler for profiling runs.
 *
 * Must be called as an explicit, used binding from the worker entries rather
 * than relied on as a bare `import './setup'` side effect: `@rstest/core`
 * declares `"sideEffects": false`, so a side-effect-only module would be
 * tree-shaken out of the worker bundle, silently dropping this handler.
 */
export function installGracefulExit(): void {
  const gracefulExit: boolean = process.execArgv.some(
    (execArg) =>
      execArg.startsWith('--perf') ||
      execArg.startsWith('--prof') ||
      execArg.startsWith('--cpu-prof') ||
      execArg.startsWith('--heap-prof') ||
      execArg.startsWith('--diagnostic-dir'),
  );

  if (gracefulExit) {
    // gracefully handle SIGTERM to generate CPU profile
    // https://github.com/nodejs/node/issues/55094
    process.on('SIGTERM', () => {
      process.exit();
    });
  }
}
