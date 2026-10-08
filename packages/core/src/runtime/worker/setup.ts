import { readFileSync, writeFileSync } from 'node:fs';

/**
 * SIGINT belongs to the session's host: process-group Ctrl+C must not kill a
 * task before the host cancels it. The host stops fork workers with SIGTERM;
 * IPC disconnect exits prevent orphans when the host dies without stopping them.
 */
export function installForkTerminationPolicy(): void {
  process.on('SIGINT', () => {});
  process.on('disconnect', () => process.exit());
}

const OOM_SCORE_ADJ = '/proc/self/oom_score_adj';

/**
 * Make the Linux OOM killer pick a fork worker before the host: a killed
 * worker's file is retried, a killed host ends the run. The score is raised
 * by 1000 over the value inherited from the host, capped at 1000. 1000 units
 * equal the whole memory limit, so the worker ranks ahead of the host, while
 * a negative score the operator assigned keeps the worker below other
 * workloads on the node. Raising needs no privilege; subprocesses spawned by
 * tests inherit the score. No effect when the cgroup is killed as a unit
 * (`memory.oom.group=1`) or when the host already runs at 1000.
 */
export function preferAsOomVictim(): void {
  if (process.platform !== 'linux') return;
  try {
    const inherited = Number.parseInt(readFileSync(OOM_SCORE_ADJ, 'utf8'), 10);
    const target = Math.min(1000, inherited + 1000);
    if (target > inherited) writeFileSync(OOM_SCORE_ADJ, String(target));
  } catch {
    // Without a writable procfs the worker keeps the score inherited from the host.
  }
}

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
