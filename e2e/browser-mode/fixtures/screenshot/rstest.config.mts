import { defineConfig } from '@rstest/core';
import path from 'node:path';

export default defineConfig({
  projects: [
    ...['project-a', 'project-b'].map((name) => ({
      name,
      testTimeout: 30_000,
      browser: {
        enabled: true,
        provider: 'playwright' as const,
        headless: true,
        expect: {
          toMatchScreenshot: {
            stabilityTimeout: 10_000,
            ...(name === 'project-b'
              ? { screenshotDirectory: 'project-b-baselines' }
              : {}),
          },
        },
      },
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/configured.test.ts'],
    })),
    {
      name: 'project-config-directory',
      testTimeout: 30_000,
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
      testTimeout: 30_000,
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
