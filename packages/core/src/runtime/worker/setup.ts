// Register the #1454 native-mock loader hooks (installed lazily, on the first
// native mock — see nativeMockHooks.ts). Node-only; this bootstrap runs only in
// the worker, never in the browser build.
import './nativeMockHooks';

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
