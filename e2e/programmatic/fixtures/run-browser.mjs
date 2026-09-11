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
      strictPort: true,
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

  const emptyRoot = join(root, 'empty');
  await mkdir(emptyRoot, { recursive: true });
  const failedBuildRstest = await createRstest({
    cwd: emptyRoot,
    config: {
      ...config,
      include: ['*.test.ts'],
      tools: {
        rspack(rspackConfig) {
          rspackConfig.plugins.push({
            apply(compiler) {
              compiler.hooks.afterCompile.tap('failed-empty-watch', () => {
                throw new Error('Browser compilation failed intentionally');
              });
            },
          });
        },
      },
    },
  });
  let buildFailure;
  watcher = await failedBuildRstest.watch({
    onResult(result) {
      buildFailure = {
        status: result.status,
        errors: result.unhandledErrors.map((error) => error.message),
      };
    },
  });
  await watcher.close();
  watcher = undefined;

  const emptyProjectCycles = [];
  let startupCompiled = false;
  let startupCompiledAtResult;
  const emptyRstest = await createRstest({
    cwd: emptyRoot,
    config: {
      ...config,
      include: ['*.test.ts'],
      tools: {
        rspack(rspackConfig) {
          rspackConfig.plugins.push({
            apply(compiler) {
              let additionalPass = true;
              compiler.hooks.thisCompilation.tap(
                'slow-empty-watch',
                (compilation) => {
                  compilation.hooks.needAdditionalPass.tap(
                    'slow-empty-watch',
                    () => {
                      if (additionalPass) {
                        additionalPass = false;
                        return true;
                      }
                    },
                  );
                },
              );
              compiler.hooks.afterCompile.tapPromise(
                'slow-empty-watch',
                async () => {
                  if (!startupCompiled) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                  }
                },
              );
              compiler.hooks.afterDone.tap('slow-empty-watch', () => {
                startupCompiled = true;
              });
            },
          });
        },
      },
    },
  });
  await watcher?.close();
  watcher = undefined;
  watcher = await emptyRstest.watch({
    onResult(result) {
      startupCompiledAtResult ??= startupCompiled;
      emptyProjectCycles.push({
        status: result.status,
        rerunTestPaths: result.rerunTestPaths.map((testPath) =>
          testPath.split('/').pop(),
        ),
        errors: result.unhandledErrors.map((error) => error.message),
      });
      resolveNextCycle?.();
    },
  });
  await waitForCycle(() =>
    writeFile(
      join(emptyRoot, 'added.test.ts'),
      `import { expect, it } from '@rstest/core';
it('runs after an empty start', () => expect(document.createElement('main').tagName).toBe('MAIN'));`,
    ),
  );
  await watcher.close();
  watcher = undefined;

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      status: result.status,
      tests: result.summary.tests.total,
      file: result.results[0]?.testPath.split('/').pop(),
      errors: result.unhandledErrors.map((error) => error.message),
      cycles,
      setupRejection,
      buildFailure,
      emptyProjectCycles,
      startupCompiledAtResult,
    })}__END__`,
  );
} finally {
  await watcher?.close();
  await rm(root, { recursive: true, force: true });
}
