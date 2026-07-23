/**
 * Helpers for reporting a failed `@rstest/core` resolution.
 *
 * A missing `@rstest/core` never reaches a notification: it is the normal state
 * of a freshly cloned repository, and discovery resolves core for every config
 * file without the user asking. It goes to the output channel instead, phrased
 * here — Node's own `MODULE_NOT_FOUND` message embeds the require stack of
 * whoever called `require.resolve`, which for a bundled extension is its `dist`
 * path plus the VS Code extension host, and says nothing about what to do.
 */

export function isModuleNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND'
  );
}

export function formatCoreNotFoundMessage({
  searchedFrom,
  configuredPackagePath,
}: {
  searchedFrom: string;
  configuredPackagePath?: string;
}): string {
  if (configuredPackagePath) {
    return `Cannot find "@rstest/core" at the configured "rstest.rstestPackagePath": ${configuredPackagePath}. Update the setting to point at an installed "@rstest/core" package.json.`;
  }
  return `Cannot find "@rstest/core" from ${searchedFrom}. Install the project dependencies, then refresh the Test Explorer. If Rstest is installed elsewhere, set "rstest.rstestPackagePath" to its package.json.`;
}
