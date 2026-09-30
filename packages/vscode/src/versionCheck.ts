const SUPPORTED_CORE_RANGE = '^0.12.0';
const RSTACK_REPO_URL = 'https://github.com/rstackjs/rstack-editor';

// Reject minor lines whose API this extension cannot drive.
// 0.12.x prereleases share the 0.12 API and are accepted deliberately.
export function isSupportedCoreVersion(version?: string): boolean {
  return version !== undefined && /^0\.12\.\d+(?:[-+]|$)/.test(version);
}

export function formatUnsupportedCoreVersionMessage(
  coreVersion?: string,
): string {
  return `Rstest has moved into the [Rstack](${RSTACK_REPO_URL}) extension. The Rstest extension only supports @rstest/core ${SUPPORTED_CORE_RANGE} (found ${coreVersion ?? 'unknown'}). Please install Rstack.`;
}
