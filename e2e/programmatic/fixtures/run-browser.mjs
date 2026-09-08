import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const root = join(fixtureDir, `.browser-${process.pid}`);
const cycles = [];
let watcher;
let resolveNextCycle;
const waitForCycle = async (change) => {
  let timer;
  const nextCycle = new Promise((resolve, reject) => {
    resolveNextCycle = resolve;
    timer = setTimeout(
      () => reject(new Error('Browser watch cycle timed out')),
      20_000,
    );
  });
  try {
    await change();
    await nextCycle;
  } finally {
    clearTimeout(timer);
  }
};
const onResult = (result) => {
  cycles.push({
    status: result.status,
    tests: result.summary.tests.total,
    errors: result.unhandledErrors.map((error) => error.message),
  });
  resolveNextCycle?.();
};

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
  const config = {
    include: ['browser.test.ts'],
    reporters: [],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      port: Number(process.argv[2]),
      providerOptions: process.env.CI
        ? { launch: { channel: 'chrome' } }
        : undefined,
    },
  };
  const rstest = await createRstest({ cwd: root, config });
  const result = await rstest.run();
  process.stdin.isTTY = true;
  watcher = await rstest.watch({ onResult });
  await waitForCycle(() =>
    writeFile(
      join(root, 'browser.test.ts'),
      `
import { expect, it } from '@rstest/core';
it('reruns in a browser', () => expect(document.title).toBe(document.title));
`,
    ),
  );
  await watcher.close();
  watcher = undefined;

  await writeFile(
    join(root, 'globalSetup.ts'),
    `export default () => { throw new Error('Browser setup failed intentionally'); };`,
  );
  const failedSetupRstest = await createRstest({
    cwd: root,
    config: { ...config, globalSetup: ['./globalSetup.ts'] },
  });
  let setupRejection;
  try {
    watcher = await failedSetupRstest.watch();
  } catch (error) {
    setupRejection = error.message;
  }

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      status: result.status,
      tests: result.summary.tests.total,
      file: result.files[0]?.testPath.split('/').pop(),
      errors: result.unhandledErrors.map((error) => error.message),
      cycles,
      setupRejection,
    })}__END__`,
  );
} finally {
  await watcher?.close();
  await rm(root, { recursive: true, force: true });
}
