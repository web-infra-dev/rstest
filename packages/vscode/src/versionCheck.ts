import semver from 'semver';

/**
 * Minimum required @rstest/core version for this VS Code extension.
 *
 * Keep this value updated manually when the extension starts depending on
 * newer core APIs.
 */
export const MIN_CORE_VERSION = '0.12.0';

export function isUnsupportedCoreVersion(coreVersion?: string): boolean {
  if (!coreVersion) return false;
  return semver.lt(coreVersion, MIN_CORE_VERSION);
}

export function formatUnsupportedCoreVersionMessage(
  coreVersion?: string,
): string {
  return `Rstest extension requires local @rstest/core >= ${MIN_CORE_VERSION}, but found ${coreVersion ?? 'unknown'}. Upgrade @rstest/core to >= ${MIN_CORE_VERSION}, or install an older version of the Rstest extension in VS Code to keep using your current @rstest/core version.`;
}

export function formatConfiguredCoreVersionWarningMessage(
  coreVersion?: string,
): string {
  return `The @rstest/core selected by rstest.rstestPackagePath is version ${coreVersion ?? 'unknown'}, below the supported >= ${MIN_CORE_VERSION}. Continuing because an explicit package path is treated as a developer override; compatibility is not guaranteed.`;
}
