import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const root = join(fixtureDir, `.browser-${process.pid}`);

await mkdir(root, { recursive: true });
await writeFile(
  join(root, 'browser.test.ts'),
  `
import { expect, it } from '@rstest/core';

it('runs in a browser', () => {
  expect(document.createElement('main').tagName).toBe('MAIN');
});
`,
);

try {
  const rstest = await createRstest({
    cwd: root,
    config: {
      include: ['browser.test.ts'],
      reporters: [],
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: 5284,
        providerOptions: process.env.CI
          ? { launch: { channel: 'chrome' } }
          : undefined,
      },
    },
  });
  const result = await rstest.run();
  const watchRejection = await rstest.watch().catch((error) => error.message);

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      status: result.status,
      tests: result.summary.tests.total,
      file: result.files[0]?.testPath.split('/').pop(),
      errors: result.unhandledErrors.map((error) => error.message),
      watchRejection,
    })}__END__`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
