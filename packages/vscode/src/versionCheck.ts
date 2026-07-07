import semver from 'semver';

/**
 * Minimum required @rstest/core version for this VS Code extension.
 *
 * Keep this value updated manually when the extension starts depending on
 * newer core APIs. This build drives the worker through the programmatic
 * `@rstest/core/api` (`createRstest`), first shipped in 0.12.0. Core 0.11.0 has
 * the `/api` subpath but only the old `runRstest` — not `createRstest` — so
 * cores below 0.12.0 would fail at worker startup.
 */
export const MIN_CORE_VERSION = '0.12.0';

export function shouldWarnCoreVersion(coreVersion?: string): boolean {
  if (!coreVersion) return false;
  return semver.lt(coreVersion, MIN_CORE_VERSION);
}

export function formatCoreVersionWarningMessage(coreVersion?: string): string {
  return `Rstest extension requires local @rstest/core >= ${MIN_CORE_VERSION}, but found ${coreVersion ?? 'unknown'}. Please upgrade @rstest/core.`;
}
