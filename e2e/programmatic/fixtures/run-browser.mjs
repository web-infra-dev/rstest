import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const root = join(fixtureDir, `.browser-${process.pid}`);
const listenerRegistrations = [];
const restoreRegistrations = [];
for (const [target, methods, events] of [
  [
    process,
    ['on', 'once', 'addListener', 'prependListener'],
    ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGTSTP'],
  ],
  [process.stdin, ['on', 'once'], ['end']],
]) {
  for (const method of methods) {
    const original = target[method];
    target[method] = function (event, listener, ...args) {
      if (events.includes(event)) {
        listenerRegistrations.push({
          event,
          listener: String(listener).slice(0, 120),
        });
      }
      return original.call(this, event, listener, ...args);
    };
    restoreRegistrations.push(() => {
      target[method] = original;
    });
  }
}
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
  const rstest = await createRstest({
    cwd: root,
    config: {
      ...config,
      plugins: [
        {
          name: 'disable-middleware-mode',
          setup(api) {
            api.modifyRsbuildConfig((config) => {
              config.server = { ...config.server, middlewareMode: false };
            });
          },
        },
      ],
    },
  });
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
  const setupCycles = [];
  let setupRejection;
  try {
    await failedSetupRstest.watch({
      onResult(result) {
        setupCycles.push({
          status: result.status,
          errors: result.unhandledErrors.map((error) => error.message),
        });
      },
    });
  } catch (error) {
    setupRejection = {
      message: error.message,
      errors: error.errors.map((error) => error.message),
    };
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
  // A fatal compile failure leaves no watcher to retry with: the cycle is reported,
  // the session ends, and `watch()` rejects.
  let buildFailure;
  let buildFailureRejection;
  try {
    await failedBuildRstest.watch({
      onResult(result) {
        buildFailure = {
          status: result.status,
          errors: result.unhandledErrors.map((error) => error.message),
        };
      },
    });
  } catch (error) {
    buildFailureRejection = error.message;
  }

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
      setupCycles,
      setupRejection,
      buildFailure,
      buildFailureRejection,
      emptyProjectCycles,
      startupCompiledAtResult,
      listenerRegistrations,
    })}__END__`,
  );
} finally {
  await watcher?.close();
  for (const restore of restoreRegistrations) restore();
  await rm(root, { recursive: true, force: true });
}
