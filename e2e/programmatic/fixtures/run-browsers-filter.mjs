import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const root = join(fixtureDir, `.browsers-filter-${process.pid}`);

const runs = [];

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

  const runWith = async (runOptions) => {
    const rstest = await createRstest({ cwd: root, config: baseConfig });
    const result = await rstest.run(runOptions);
    runs.push({
      filter: runOptions?.browser?.browsers ?? 'none',
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
    });
  };

  // The /api path filters the configured browsers like the CLI flag:
  // a single selected browser executes exactly one copy of the file.
  await runWith(undefined);
  await runWith({ browser: { browsers: 'firefox' } });
  await runWith({ browser: { browsers: 'chromium' } });

  console.log(`__RSTEST_API_RESULT__${JSON.stringify({ runs })}__END__`);
} finally {
  await rm(root, { recursive: true, force: true });
}
