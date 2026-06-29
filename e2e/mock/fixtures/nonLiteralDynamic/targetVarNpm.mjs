// Imported ONLY via a non-literal `import(variable)`, so Node loads it natively.
// Its bare `strip-ansi` import exercises the registerHooks NON-builtin branch
// (real resolution via `nextResolve`, keyed by the resolved URL) — distinct from
// the builtin (`node:os`) path.
import stripAnsi from 'strip-ansi';

export const probe = () => stripAnsi('x');
