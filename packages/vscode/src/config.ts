import vscode from 'vscode';

// Centralized configuration types for the extension.
// Add new keys here to extend configuration in a type-safe way.
export type ExtensionConfig = {
  // Glob patterns that determine which files are considered tests.
  // Must be an array of strings.
  testFileGlobPattern: string[];
  // The path to a package.json file of a Rstest executable.
  // Used as a last resort if the extension cannot auto-detect @rstest/core.
  rstestPackagePath?: string;
};

export const defaultConfig: ExtensionConfig = {
  testFileGlobPattern: ['**/*.test.*', '**/*.spec.*'],
};

// Type-safe getter for a single config value with priority:
// workspaceFolder > workspace > user (global) > default.
export function getConfigValue<K extends keyof ExtensionConfig>(
  key: K,
  folder?: vscode.WorkspaceFolder,
): ExtensionConfig[K] {
  const section = vscode.workspace.getConfiguration('rstest', folder);
  const inspected = section.inspect<ExtensionConfig[K]>(key);

  // Priority order (highest first): folder, workspace, user, default
  const value =
    inspected?.workspaceFolderValue ??
    inspected?.workspaceValue ??
    inspected?.globalValue ??
    inspected?.defaultValue ??
    defaultConfig[key];

  if (key === 'testFileGlobPattern') {
    const v = value as unknown;
    return (isStringArray(v) ? v : defaultConfig[key]) as ExtensionConfig[K];
  }

  if (key === 'rstestPackagePath') {
    const v = value as unknown;
    return (
      typeof v === 'string' && v.trim().length > 0 ? v : undefined
    ) as ExtensionConfig[K];
  }

  return value as ExtensionConfig[K];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

// Convenience to get a full, normalized config object at the given scope.
export function getConfig(folder?: vscode.WorkspaceFolder): ExtensionConfig {
  return {
    testFileGlobPattern: getConfigValue('testFileGlobPattern', folder),
    rstestPackagePath: getConfigValue('rstestPackagePath', folder),
  } satisfies ExtensionConfig;
}
