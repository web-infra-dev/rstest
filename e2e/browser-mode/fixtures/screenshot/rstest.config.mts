import { defineConfig } from '@rstest/core';
import path from 'node:path';

export default defineConfig({
  testTimeout: 30_000,
  projects: [
    ...['project-a', 'project-b'].map((name) => ({
      name,
      browser: {
        enabled: true,
        provider: 'playwright' as const,
        headless: true,
        expect: { toMatchScreenshot: { stabilityTimeout: 10_000 } },
      },
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/configured.test.ts'],
    })),
    {
      name: 'project-config-directory',
      browser: {
        enabled: true,
        provider: 'playwright' as const,
        headless: true,
        expect: {
          toMatchScreenshot: {
            stabilityTimeout: 10_000,
            comparatorOptions: { maxDiffPixels: 1 },
            screenshotDirectory: 'custom-baselines',
          },
        },
      },
      include: ['tests/configured.test.ts'],
    },
    {
      name: 'project-config-resolver',
      browser: {
        enabled: true,
        provider: 'playwright' as const,
        headless: true,
        expect: {
          toMatchScreenshot: {
            stabilityTimeout: 10_000,
            comparatorOptions: { maxDiffPixels: 1 },
            resolveScreenshotPath: ({ testFilePath, projectName, testName }) =>
              path.join(
                'custom-paths',
                projectName,
                path.basename(testFilePath),
                `${testName}.png`,
              ),
          },
        },
      },
      include: ['tests/configured.test.ts'],
    },
  ],
});
