import Module from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { onTestFinished as onRstestFinished } from '@rstest/core';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Re-derived from `process.versions.node` rather than imported from
 * `@rstest/core` internals — the fixtures run in a child process on this same
 * Node, so the predicate must match `supportsRuntimeTsHook()` in
 * `packages/core/src/runtime/worker/runtimeTsHook.ts`.
 *
 * Sync-hook CJS loading was only made reentrancy-safe by
 * https://github.com/nodejs/node/pull/59929 (v22.22.3 / v24.11.1 / v25.1.0 /
 * v26.0.0). Below those versions the feature stays inactive by design, so these
 * tests have nothing to assert.
 */
const supportsRuntimeTsHook = (): boolean => {
  if (typeof Module.registerHooks !== 'function') {
    return false;
  }

  const [major = 0, minor = 0, patch = 0] = process.versions.node
    .split('.')
    .map(Number);
  const atLeast = (targetMinor: number, targetPatch: number) =>
    minor > targetMinor || (minor === targetMinor && patch >= targetPatch);

  if (major >= 26) return true;
  if (major === 25) return atLeast(1, 0);
  if (major === 24) return atLeast(11, 1);
  if (major === 22) return atLeast(22, 3);
  return false;
};

const runFixture = async (
  fixture: string,
  onTestFinished: typeof onRstestFinished,
) =>
  runRstestCli({
    command: 'rstest',
    args: ['run'],
    onTestFinished,
    options: {
      nodeOptions: {
        // This test spawns nested `rstest` runs. In the e2e `test:no-isolate`
        // step we set `ISOLATE=false`, which would be inherited by the child
        // process and make the nested run non-isolated as well (flaky on CI).
        env: { ISOLATE: undefined },
        cwd: join(__dirname, fixture),
      },
    },
  });

describe.skipIf(!supportsRuntimeTsHook())(
  `runtimeTsTransform (requires Node >= 22.22.3 / >= 24.11.1, current: ${process.versions.node})`,
  () => {
    it('should load a cjs-style .ts at runtime in a type module scope', async ({
      onTestFinished,
    }) => {
      const { expectExecSuccess } = await runFixture(
        'fixtures',
        onTestFinished,
      );

      await expectExecSuccess();
    });

    it('should fail natively when runtimeTsTransform is disabled', async ({
      onTestFinished,
    }) => {
      const { expectExecFailed, expectStderrLog } = await runFixture(
        'fixtures-opt-out',
        onTestFinished,
      );

      await expectExecFailed();

      // `expectStderrLog` matches per line, so keep this single-line.
      expectStderrLog(/module is not defined/);
    });

    it('should load an esm-style .ts at runtime in a type commonjs scope', async ({
      onTestFinished,
    }) => {
      const { expectExecSuccess } = await runFixture(
        'fixtures-cjs-scope',
        onTestFinished,
      );

      await expectExecSuccess();
    });

    it('should let a third-party .ts extension keep ownership of the require path', async ({
      onTestFinished,
    }) => {
      const { expectExecSuccess } = await runFixture(
        'fixtures-coexist',
        onTestFinished,
      );

      await expectExecSuccess();
    });
  },
);
