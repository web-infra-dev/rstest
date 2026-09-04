const MIN_CORE_VERSION = '0.12.0';

export function formatUnsupportedCoreVersionMessage(
  coreVersion?: string,
): string {
  return `Rstest extension requires local @rstest/core >= ${MIN_CORE_VERSION}, but found ${coreVersion ?? 'unknown'}. Upgrade @rstest/core to >= ${MIN_CORE_VERSION}, or install an older version of the Rstest extension in VS Code to keep using your current @rstest/core version.`;
}
