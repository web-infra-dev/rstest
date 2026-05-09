import type { RsbuildPlugin } from '@rsbuild/core';
import { pluginAreTheTypesWrong } from 'rsbuild-plugin-arethetypeswrong';
import { pluginPublint } from 'rsbuild-plugin-publint';

/**
 * Returns the publish-readiness plugins (publint + attw) when running a one-shot
 * `rslib build`. Skipped in `--watch` mode to keep the inner dev loop fast.
 *
 * Both plugins inspect the freshly built dist + package.json against the
 * conventions npm consumers rely on:
 *   - publint: package.json `exports`, `types`, `main` consistency
 *   - attw: type-resolution correctness across module systems
 */
export function publishCheckPlugins(): RsbuildPlugin[] {
  const isWatch = process.argv.includes('--watch');
  // Set SKIP_PUBLISH_CHECK=1 for fast local iteration when rebuilding the
  // monorepo. CI never sets it.
  if (isWatch || process.env.SKIP_PUBLISH_CHECK === '1') return [];
  return [
    pluginPublint(),
    pluginAreTheTypesWrong({
      areTheTypesWrongOptions: {
        // rstest packages are ESM-only; node10 + cjs consumers are out of scope.
        ignoreResolutions: ['node10', 'node16-cjs'],
        // TODO: drop this ignore once the internal-type-resolution chains in
        // @rstest/browser, @rstest/browser-react, @rstest/coverage-istanbul are
        // fixed. Tracked as the v1 cleanup follow-up.
        ignoreRules: ['internal-resolution-error'],
      },
    }),
  ];
}
