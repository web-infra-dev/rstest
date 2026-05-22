import { defineConfig } from 'bumpp';

export type PackageGroup = {
  name: string;
  files: string[];
  commitMessage: string;
};

export const packageGroups: Record<string, PackageGroup> = {
  core: {
    name: 'Rstest packages',
    files: [
      'packages/core/package.json',
      'packages/browser/package.json',
      'packages/browser-react/package.json',
      'packages/coverage-istanbul/package.json',
      'packages/coverage-v8/package.json',
      'packages/adapter-rslib/package.json',
      'packages/adapter-rsbuild/package.json',
      'packages/adapter-rspack/package.json',
      'packages/vscode/package.json',
    ],
    commitMessage: 'release: %s',
  },
};

export default defineConfig({
  tag: false,
  push: false,
});
