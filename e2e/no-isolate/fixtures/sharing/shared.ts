// Counts its own evaluations on the worker's `globalThis`. Evaluated once per
// worker (correct) → every file sees id `1`; re-evaluated per file (the bug) →
// the second file sees `2`. See https://github.com/web-infra-dev/rstest/issues/1373.
const g = globalThis as Record<string, any>;
g.__rstestSharedEvalCount = (g.__rstestSharedEvalCount ?? 0) + 1;
const evalIdAtLoad: number = g.__rstestSharedEvalCount;

export const getSharedEvalId = (): number => evalIdAtLoad;
