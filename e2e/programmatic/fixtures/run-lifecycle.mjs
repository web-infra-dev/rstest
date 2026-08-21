import { writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const cwd = join(fixtureDir, 'disk');
const discoveredConfig = join(cwd, 'rstest.config.mjs');
let factoryCalls = 0;
let reporterFiles = 0;

await writeFile(
  discoveredConfig,
  `export default { include: ['failing.test.ts'], reporters: [] };\n`,
);

try {
  const rstest = await createRstest({
    cwd,
    config: () => {
      factoryCalls += 1;
      return {
        include: ['sum.test.ts'],
        reporters: [
          {
            onTestFileResult() {
              reporterFiles += 1;
            },
          },
        ],
      };
    },
  });

  const oneShot = await rstest.run();
  const runner = await rstest.createRunner({
    filters: ['sum.test.ts'],
    filterMode: 'exact',
  });

  const errors = {};
  try {
    await runner.run();
  } catch (error) {
    errors.beforeBuild = error.message;
  }

  const build = await runner.build();
  try {
    await runner.build();
  } catch (error) {
    errors.secondBuild = error.message;
  }

  const narrowed = await runner.run({ testNamePattern: String.raw`1 \+ 2` });
  const restored = await runner.run();
  const outsideBuild = await runner.run({
    filters: ['failing.test.ts'],
    filterMode: 'exact',
    passWithNoTests: true,
  });
  await runner.close();
  await runner.close();
  try {
    await runner.run();
  } catch (error) {
    errors.afterClose = error.message;
  }

  const runnerCycles = [];
  const cycleRstest = await createRstest({
    cwd,
    config: {
      include: ['sum.test.ts', 'failing.test.ts'],
      reporters: [
        {
          onTestRunEnd({ results }) {
            runnerCycles.push(
              results.map((result) => result.testPath.split('/').pop()),
            );
          },
        },
      ],
    },
  });
  const cycleRunner = await cycleRstest.createRunner();
  await cycleRunner.build();
  await cycleRunner.run();
  const filteredCycle = await cycleRunner.run({
    filters: ['sum.test.ts'],
    filterMode: 'exact',
  });
  await cycleRunner.close();

  const blobRstest = await createRstest({
    cwd,
    config: {
      include: ['sum.test.ts'],
      reporters: ['blob'],
    },
  });
  let blobRunnerError;
  try {
    await blobRstest.createRunner();
  } catch (error) {
    blobRunnerError = error.message;
  }

  const buildFailure = await createRstest({
    cwd,
    config: {
      include: ['sum.test.ts'],
      reporters: [],
      tools: {
        rspack() {
          throw new Error('programmatic build exploded');
        },
      },
    },
  });
  const oneShotBuildFailure = await buildFailure.run();
  const failedRunner = await buildFailure.createRunner();
  let runnerBuildFailure;
  try {
    await failedRunner.build();
  } catch (error) {
    runnerBuildFailure = error.message;
  } finally {
    await failedRunner.close();
  }

  let runtimeFactoryCalls = 0;
  const runtimeConfigFailure = await createRstest({
    cwd,
    config: () => {
      runtimeFactoryCalls += 1;
      if (runtimeFactoryCalls > 1) {
        throw new Error('runtime config exploded');
      }
      return { include: ['sum.test.ts'], reporters: [] };
    },
  });
  const runtimeFailure = await runtimeConfigFailure.run();

  const teardownRoot = join(
    fixtureDir,
    '../../globalSetup/fixtures/teardown-error',
  );
  const teardownRstest = await createRstest({
    cwd: teardownRoot,
    config: {
      globalSetup: './globalSetup.ts',
      include: ['index.test.ts'],
      reporters: [],
    },
  });
  const teardownRunner = await teardownRstest.createRunner();
  await teardownRunner.build();
  const teardownRun = await teardownRunner.run();
  const teardownCloseErrors = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await teardownRunner.close();
    } catch (error) {
      teardownCloseErrors.push(error.message);
    }
  }

  const globalSetupFailureRoot = join(
    fixtureDir,
    '../../globalSetup/fixtures/error',
  );
  const globalSetupFailureRstest = await createRstest({
    cwd: globalSetupFailureRoot,
    config: {
      globalSetup: './globalSetup.ts',
      include: ['index.test.ts'],
      reporters: [],
    },
  });
  const globalSetupFailureRunner =
    await globalSetupFailureRstest.createRunner();
  await globalSetupFailureRunner.build();
  const firstGlobalSetupFailure = await globalSetupFailureRunner.run();
  const secondGlobalSetupFailure = await globalSetupFailureRunner.run();
  await globalSetupFailureRunner.close();

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      context: {
        root: rstest.context.root,
        include: rstest.context.config.include,
        projects: rstest.context.projects,
      },
      factoryCalls,
      reporterFiles,
      oneShot: {
        ok: oneShot.ok,
        tests: oneShot.stats.tests.total,
      },
      buildFiles: build.testFiles.map((file) => file.split('/').pop()),
      narrowed: narrowed.stats.tests,
      restored: restored.stats.tests,
      outsideBuild: {
        ok: outsideBuild.ok,
        files: outsideBuild.stats.files.total,
      },
      runnerCycles,
      filteredCycle: {
        ok: filteredCycle.ok,
        files: filteredCycle.files.map((file) =>
          file.testPath.split('/').pop(),
        ),
      },
      blobRunnerError,
      errors,
      oneShotBuildFailure: {
        ok: oneShotBuildFailure.ok,
        message: oneShotBuildFailure.unhandledErrors[0]?.message,
      },
      runnerBuildFailure,
      runtimeFailure: {
        ok: runtimeFailure.ok,
        message: runtimeFailure.unhandledErrors[0]?.message,
        snapshotPresent: runtimeFailure.snapshot !== undefined,
      },
      teardownFailure: {
        runOk: teardownRun.ok,
        closeErrors: teardownCloseErrors,
      },
      globalSetupFailure: {
        first: {
          ok: firstGlobalSetupFailure.ok,
          files: firstGlobalSetupFailure.stats.files.total,
          tests: firstGlobalSetupFailure.stats.tests.total,
          message: firstGlobalSetupFailure.unhandledErrors[0]?.message,
        },
        second: {
          ok: secondGlobalSetupFailure.ok,
          files: secondGlobalSetupFailure.stats.files.total,
          tests: secondGlobalSetupFailure.stats.tests.total,
          message: secondGlobalSetupFailure.unhandledErrors[0]?.message,
          cause: secondGlobalSetupFailure.unhandledErrors[0]?.cause?.message,
        },
      },
    })}__END__`,
  );
} finally {
  await rm(discoveredConfig, { force: true });
}
