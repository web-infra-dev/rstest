import { pluginAreTheTypesWrong } from 'rsbuild-plugin-arethetypeswrong';
import { pluginPublint } from 'rsbuild-plugin-publint';

/**
 * Shared `publint` + `arethetypeswrong` checks for every publishable
 * package in this monorepo. Run after each Rslib build to catch publish
 * issues before they ship.
 *
 * `ignoreResolutions: ['node10', 'node16-cjs']` is the attw CLI's
 * `--profile esm-only` (see attw `packages/cli/src/profiles.ts`): every
 * package here is ESM-only by design, so warnings about CJS consumers
 * needing dynamic import are intentional, not bugs.
 */
export function publishCheckPlugins() {
  return [
    pluginPublint(),
    pluginAreTheTypesWrong({
      areTheTypesWrongOptions: {
        ignoreResolutions: ['node10', 'node16-cjs'],
      },
    }),
  ];
}
