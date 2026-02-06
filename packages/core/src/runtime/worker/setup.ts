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

const originalStderrWrite: typeof process.stderr.write =
  process.stderr.write.bind(process.stderr);

process.stderr.write = (
  chunk: Uint8Array | string,
  ...args: any[]
): boolean => {
  const text = typeof chunk === 'string' ? chunk : chunk.toString();
  // prefix with process id to make it easier to identify which worker the stderr is coming from
  return originalStderrWrite(`[Worker:stderr] ${text}`, ...args);
};
