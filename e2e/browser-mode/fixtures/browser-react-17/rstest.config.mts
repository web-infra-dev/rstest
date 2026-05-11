import { createRequire } from 'node:module';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

const require = createRequire(import.meta.url);

// Workspace-only plumbing: pnpm symlinks `@rstest/browser-react` into this
// fixture, so the bundler walks the realpath and resolves `react` / `react-dom`
// from `packages/browser-react/node_modules` (devDep React 19) instead of the
// fixture's pinned React 17. These exact-match aliases pin resolution to the
// fixture's own copies. End users installing from npm don't need this.
export default defineConfig({
  plugins: [pluginReact()],
  resolve: {
    alias: {
      react$: require.resolve('react'),
      'react-dom$': require.resolve('react-dom'),
      'react-dom/test-utils': require.resolve('react-dom/test-utils'),
      'react/jsx-runtime$': require.resolve('react/jsx-runtime'),
      'react/jsx-dev-runtime$': require.resolve('react/jsx-dev-runtime'),
    },
  },
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-react-17'],
  },
  include: ['tests/**/*.test.tsx'],
  testTimeout: 30000,
});
