// Counts its own evaluations on the worker's `globalThis`. Evaluated once per
// worker (correct) → every file sees id `1`; re-evaluated per file (the bug) →
// the second file sees `2`. See https://github.com/web-infra-dev/rstest/issues/1373.
const g = globalThis as Record<string, any>;
g.__rstestSharedEvalCount = (g.__rstestSharedEvalCount ?? 0) + 1;
const evalIdAtLoad: number = g.__rstestSharedEvalCount;

export const getSharedEvalId = (): number => evalIdAtLoad;

// The same once-per-worker evaluation, applied to the DOM: these bind at import
// exactly like `@testing-library/dom`'s `screen` binds `document.body`. The
// test environment must therefore outlive the file that evaluated this module,
// or the captures dangle on a closed window from the second file on.
// See https://github.com/web-infra-dev/rstest/issues/767.
export const capturedBody: HTMLElement = document.body;
export const capturedDocument: Document = document;
