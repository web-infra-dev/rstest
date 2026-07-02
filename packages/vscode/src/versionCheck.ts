import semver from 'semver';

/**
 * Minimum required @rstest/core version for this VS Code extension.
 *
 * Keep this value updated manually when the extension starts depending on
 * newer core APIs. This build drives the worker through the programmatic
 * `@rstest/core/api` (`createRstest`), first shipped in 0.10.7, so cores below
 * that lack the export and would fail at worker startup.
 */
export const MIN_CORE_VERSION = '0.10.7';

export function shouldWarnCoreVersion(coreVersion?: string): boolean {
  if (!coreVersion) return false;
  return semver.lt(coreVersion, MIN_CORE_VERSION);
}

export function formatCoreVersionWarningMessage(coreVersion?: string): string {
  return `Rstest extension requires local @rstest/core >= ${MIN_CORE_VERSION}, but found ${coreVersion ?? 'unknown'}. Please upgrade @rstest/core.`;
}
