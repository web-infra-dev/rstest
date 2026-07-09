import semver from 'semver';

/**
 * Minimum required @rstest/core version for this VS Code extension.
 *
 * Keep this value updated manually when the extension starts depending on
 * newer core APIs.
 */
export const MIN_CORE_VERSION = '0.6.0';

export function shouldWarnCoreVersion(coreVersion?: string): boolean {
  if (!coreVersion) return false;
  return semver.lt(coreVersion, MIN_CORE_VERSION);
}

export function formatCoreVersionWarningMessage(coreVersion?: string): string {
  return `Rstest extension requires local @rstest/core >= ${MIN_CORE_VERSION}, but found ${coreVersion ?? 'unknown'}. Please upgrade @rstest/core.`;
}
