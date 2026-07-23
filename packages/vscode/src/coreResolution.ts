/**
 * Helpers for reporting a failed `@rstest/core` resolution.
 *
 * Both messages replace Node's own `MODULE_NOT_FOUND` text, which embeds the
 * require stack of whoever called `require.resolve` — for a bundled extension
 * its `dist` path plus the VS Code extension host — and says nothing about what
 * to do. They differ in where they end up: an uninstalled core is the normal
 * state of a freshly cloned repository and is resolved for every config file
 * without the user asking, so it is only logged; a `rstestPackagePath` that
 * does not resolve is a setting the user has to fix, so it is notified.
 */

// Whether `specifier` itself is what could not be found. `MODULE_NOT_FOUND`
// alone is too broad: a package that is installed but whose entry file is gone
// (an interrupted install, or a workspace link that has not been built) throws
// it too, and that must not be reported as "not installed". Node names the
// resolved file in that case and the requested specifier in this one, so the
// message is what separates them. A future Node wording change therefore fails
// towards reporting rather than towards silence.
export function isModuleNotFoundError(
  error: unknown,
  specifier: string,
): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' &&
    error.message.startsWith(`Cannot find module '${specifier}'`)
  );
}

export function formatCoreNotFoundMessage(searchedFrom: string): string {
  return `Cannot find "@rstest/core" from ${searchedFrom}. Install the project dependencies, then refresh the Test Explorer. If Rstest is installed elsewhere, set "rstest.rstestPackagePath" to its package.json.`;
}

export function formatConfiguredCoreNotFoundMessage(
  configuredPackagePath: string,
): string {
  return `Cannot find "@rstest/core" at the configured "rstest.rstestPackagePath": ${configuredPackagePath}. Update the setting to point at an installed "@rstest/core" package.json.`;
}
