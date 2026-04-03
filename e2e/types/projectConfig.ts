import {
  defineConfig,
  defineInlineProject,
  defineProject,
  type ProjectConfig,
} from '@rstest/core';

export const inlineNodeProject = defineInlineProject({
  name: 'runtime-utils-node',
  root: __dirname,
  testEnvironment: 'node',
  exclude: [
    'tests/universal/cache-client.test.ts',
    'tests/browser/**/*.{test,spec}.{js,cjs,mjs,ts,tsx}',
  ],
  globals: true,
});

export const inlineClientProject = defineInlineProject({
  name: 'runtime-utils-client',
  root: __dirname,
  testEnvironment: 'jsdom',
  include: [
    'tests/universal/cache-client.test.ts',
    'tests/browser/**/*.{test,spec}.{js,cjs,mjs,ts,tsx}',
  ],
  globals: true,
});

export const inlineBrowserProject = defineInlineProject({
  name: 'runtime-utils-browser',
  root: __dirname,
  include: ['tests/browser/**/*.test.ts'],
  browser: {
    enabled: true,
    provider: 'playwright',
  },
});

export const exportedProject = defineProject({
  root: __dirname,
  testEnvironment: 'node',
  include: ['tests/node/**/*.test.ts'],
});

export const exportedProjectFactory = defineProject(
  (): ProjectConfig => ({
    root: __dirname,
    testEnvironment: 'jsdom',
    include: ['tests/dom/**/*.test.ts'],
  }),
);

export const exportedNestedProjects = defineProject({
  projects: [
    defineInlineProject({
      name: 'nested-node',
      root: __dirname,
      include: ['tests/nested/node/**/*.test.ts'],
      testEnvironment: 'node',
    }),
    defineInlineProject({
      name: 'nested-client',
      root: __dirname,
      include: ['tests/nested/client/**/*.test.ts'],
      testEnvironment: 'jsdom',
    }),
  ],
});

export const exportedNestedProjectsFactory = defineProject(async () => ({
  projects: [
    defineInlineProject({
      name: 'async-nested-node',
      root: __dirname,
      include: ['tests/async/node/**/*.test.ts'],
      testEnvironment: 'node',
    }),
    defineInlineProject({
      name: 'async-nested-client',
      root: __dirname,
      include: ['tests/async/client/**/*.test.ts'],
      testEnvironment: 'jsdom',
    }),
  ],
}));

export default defineConfig({
  projects: [
    inlineNodeProject,
    inlineClientProject,
    inlineBrowserProject,
    defineInlineProject({
      name: 'runtime-utils-happy-dom',
      root: __dirname,
      include: ['tests/happy-dom/**/*.test.ts'],
      testEnvironment: 'happy-dom',
    }),
  ],
});
