declare module '@rstest/browser-manifest' {
  export const manifest: Array<{
    id: string;
    type: 'setup' | 'test';
    projectName: string;
    projectRoot: string;
    filePath: string;
    testPath?: string;
    relativePath: string;
    load: () => Promise<unknown>;
  }>;
}
