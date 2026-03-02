import * as v from 'valibot';
import vscode from 'vscode';

// Centralized configuration types for the extension.
// Add new keys here to extend configuration in a type-safe way.
const configSchema = v.object({
  // The path to a package.json file of a Rstest executable.
  // Used as a last resort if the extension cannot auto-detect @rstest/core.
  rstestPackagePath: v.fallback(v.optional(v.string()), undefined),
  configFileGlobPattern: v.fallback(v.array(v.string()), [
    '**/rstest.config.{mjs,ts,js,cjs,mts,cts}',
  ]),
  testCaseCollectMethod: v.fallback(
    v.union([v.literal('ast'), v.literal('runtime')]),
    'ast',
  ),
  applyDiagnostic: v.fallback(v.boolean(), true),
});

export type ExtensionConfig = v.InferOutput<typeof configSchema>;

// Type-safe getter for a single config value
export function getConfigValue<K extends keyof ExtensionConfig>(
  key: K,
  scope?: vscode.ConfigurationScope | null,
): ExtensionConfig[K] {
  const value = vscode.workspace.getConfiguration('rstest', scope).get(key);
  return v.parse(configSchema.entries[key], value) as ExtensionConfig[K];
}

// Convenience to get a full, normalized config object at the given scope.
export function getConfig(
  scope?: vscode.ConfigurationScope | null,
): ExtensionConfig {
  return Object.fromEntries(
    Object.keys(configSchema.entries).map((key) => [
      key,
      getConfigValue(key as keyof ExtensionConfig, scope),
    ]),
  ) as ExtensionConfig;
}

export function watchConfigValue<K extends keyof ExtensionConfig>(
  key: K,
  scope: vscode.ConfigurationScope | null | undefined,
  listener: (
    value: ExtensionConfig[K],
    token: vscode.CancellationToken,
  ) => void,
): vscode.Disposable {
  let cancelSource = new vscode.CancellationTokenSource();
  listener(getConfigValue(key, scope), cancelSource.token);
  const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(`rstest.${key}`, scope ?? undefined)) {
      cancelSource.cancel();
      cancelSource = new vscode.CancellationTokenSource();
      listener(getConfigValue(key, scope), cancelSource.token);
    }
  });
  return {
    dispose: () => {
      disposable.dispose();
      cancelSource.cancel();
    },
  };
}
