import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

// One process per case: the whole programmatic suite runs with other e2e
// files in parallel, and the firefox boot is the slow part — a process that
// only has to launch and run once cannot outlive its test's timeout.
const fixtureDir = dirname(fileURLToPath(import.meta.url));
// filter = 'none' | 'firefox' | 'chromium'
const filter = process.argv[3];
const runOptions =
  filter === 'none' ? undefined : { browser: { browsers: filter } };
const root = join(fixtureDir, `.browsers-filter-${process.pid}`);

try {
  await mkdir(root, { recursive: true });
  // `window.innerWidth` reads the (project, browser) entry viewport, so a run
  // only passes in the browser whose entry viewport was 900 wide: a browser
  // filter that selected the wrong browser (or left an extra one in) fails the
  // in-page assertion instead of passing silently.
  await writeFile(
    join(root, 'browser.test.ts'),
    `import { expect, it } from '@rstest/core';

it('runs in the selected browser', () => {
  expect(window.innerWidth).toBe(900);
});
`,
  );

  const baseConfig = {
    include: ['browser.test.ts'],
    reporters: [],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      port: Number(process.argv[2]),
      strictPort: true,
      // Each browser of a run gets its own row; the CI runners install only
      // the chrome channel (mirroring run-browser.mjs), firefox stays bundled.
      browsers: [
        {
          browserName: 'chromium',
          viewport: { width: 800, height: 600 },
          ...(process.env.CI
            ? { providerOptions: { launch: { channel: 'chrome' } } }
            : {}),
        },
        {
          browserName: 'firefox',
          viewport: { width: 900, height: 600 },
        },
      ],
    },
  };

  const rstest = await createRstest({ cwd: root, config: baseConfig });
  const result = await rstest.run(runOptions);

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      filter,
      status: result.status,
      tests: result.summary.tests,
      files: result.summary.files,
      // Failure text distinguishes which browser executed the file: only a
      // copy whose entry viewport is 800 wide expects innerWidth != 900.
      testMessages: result.results.flatMap((fileResult) =>
        (fileResult.results ?? []).flatMap((testResults) =>
          (testResults.errors ?? []).map((error) =>
            String((error.detail ?? error)?.message ?? error),
          ),
        ),
      ),
      // Per-file attribution: an unfiltered run reports one project per
      // (project, browser) with its own results, so each says who ran it.
      fileResults: result.results.map((fileResult) => ({
        project: fileResult.project,
        status: fileResult.status,
        message: String(
          (fileResult.results ?? [])
            .flatMap((testResults) => testResults.errors ?? [])
            .map((error) => String((error.detail ?? error)?.message ?? error))
            .join(' | '),
        ),
      })),
    })}__END__`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
