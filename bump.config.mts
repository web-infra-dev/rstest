import { defineConfig } from 'bumpp';

export type PackageGroup = {
  name: string;
  files: string[];
  commitMessage: string;
};

export const packageGroups: Record<string, PackageGroup> = {
  core: {
    name: 'Core packages (core, browser, browser-react, vscode)',
    files: [
      'packages/core/package.json',
      'packages/browser/package.json',
      'packages/browser-react/package.json',
      'packages/vscode/package.json',
    ],
    commitMessage: 'release: %s',
  },
  'coverage-istanbul': {
    name: '@rstest/coverage-istanbul',
    files: ['packages/coverage-istanbul/package.json'],
    commitMessage: 'release: @rstest/coverage-istanbul %s',
  },
  'adapter-rslib': {
    name: '@rstest/adapter-rslib',
    files: ['packages/adapter-rslib/package.json'],
    commitMessage: 'release: @rstest/adapter-rslib %s',
  },
  'adapter-rsbuild': {
    name: '@rstest/adapter-rsbuild',
    files: ['packages/adapter-rsbuild/package.json'],
    commitMessage: 'release: @rstest/adapter-rsbuild %s',
  },
};

export default defineConfig({
  tag: false,
  push: false,
});
