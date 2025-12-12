declare module '@rstest/browser-manifest' {
  /** Project configuration from manifest */
  export type ManifestProjectConfig = {
    name: string;
    environmentName: string;
    projectRoot: string;
  };

  /** Test context for a project */
  export type ManifestTestContext = {
    getTestKeys: () => string[];
    loadTest: (key: string) => Promise<unknown>;
    projectRoot: string;
  };

  /** All projects configuration (multi-project support) */
  export const projects: ManifestProjectConfig[];

  /** Setup loaders for each project, keyed by project name */
  export const projectSetupLoaders: Record<
    string,
    Array<() => Promise<unknown>>
  >;

  /** Test contexts for each project, keyed by project name */
  export const projectTestContexts: Record<string, ManifestTestContext>;

  // Backward compatibility exports (use first project as default)

  /** @deprecated Use `projects[0]` instead */
  export const projectConfig: ManifestProjectConfig;

  /** @deprecated Use `projectSetupLoaders[projectName]` instead */
  export const setupLoaders: Array<() => Promise<unknown>>;

  /** @deprecated Use `projectTestContexts[projectName].getTestKeys()` instead */
  export function getTestKeys(): string[];

  /** @deprecated Use `projectTestContexts[projectName].loadTest(key)` instead */
  export function loadTest(key: string): Promise<unknown>;
}
