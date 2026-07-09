import { createRequire } from 'node:module';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from '@rstest/core';

const require = createRequire(import.meta.url);
const coreDist = join(
  dirname(require.resolve('@rstest/core/package.json')),
  'dist',
);

/**
 * Concatenate the source of every emitted chunk transitively reachable from an
 * entry chunk by following its `import ... from "./x.js"` / `import "./x.js"`
 * edges. Used to assert what survives tree-shaking in the shipped bundle.
 */
const reachableSource = (entry: string): string => {
  const seen = new Set<string>();
  const stack = [entry];
  let combined = '';
  for (let file = stack.pop(); file; file = stack.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const abs = join(coreDist, file);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    combined += src;
    for (const [, rel] of src.matchAll(
      /(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g,
    )) {
      if (rel) stack.push(rel.slice(2));
    }
  }
  return combined;
};

/**
 * `@rstest/core` ships `"sideEffects": false` so consumers can tree-shake it.
 * The worker's profiling graceful-exit handler (`src/runtime/worker/setup.ts`)
 * is the one piece that must survive that tree-shaking: it is only kept because
 * the worker entries call `installGracefulExit()` as a used binding. If someone
 * reverts to a bare `import './setup'`, the module becomes side-effect-only and
 * is dropped from the bundle — these assertions catch that regression, which a
 * unit test importing the function directly cannot.
 */
describe('@rstest/core sideEffects tree-shaking', () => {
  // Both worker entries call `installGracefulExit()`, so the handler must be
  // reachable from each. `--cpu-prof` is unique to setup.ts's profiling guard;
  // SIGTERM is the handler it installs. Both vanish if setup.ts is dropped.
  for (const entry of ['worker.js', 'globalSetupWorker.js']) {
    it(`keeps the profiling graceful-exit handler reachable from ${entry}`, () => {
      const src = reachableSource(entry);
      expect(src).toContain('cpu-prof');
      expect(src).toContain('SIGTERM');
    });
  }
});
