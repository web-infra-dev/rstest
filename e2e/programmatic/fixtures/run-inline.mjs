import { rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');
const discoveredConfig = join(cwd, 'rstest.config.mjs');
let reporterFiles = 0;
let effectivePool;

await writeFile(
  discoveredConfig,
  `export default { include: ['failing.test.ts'], reporters: [] };\n`,
);

try {
  const rstest = await createRstest({
    cwd,
    config: {
      include: ['*.test.ts'],
      exclude: ['failing.test.ts'],
      reporters: [
        {
          onTestFileResult() {
            reporterFiles += 1;
          },
        },
      ],
      plugins: [
        {
          name: 'capture-run-pool',
          setup(api) {
            effectivePool = api.useExposed('rstest').getRstestConfig().pool;
          },
        },
      ],
    },
  });
  const result = await rstest.run({
    changed: false,
    pool: {
      type: process.argv[2],
      maxWorkers: 1,
      memoryLimit: '256MB',
    },
  });

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
  let buildFailureResult;
  try {
    buildFailureResult = await buildFailure.run();
  } catch (error) {
    buildFailureResult = { status: 'rejected', message: error.message };
  }

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      context: {
        rootPath: rstest.context.rootPath,
        include: rstest.context.config.include,
        projects: rstest.context.projects,
      },
      reporterFiles,
      pool: effectivePool,
      status: result.status,
      summary: result.summary,
      results: result.results.map((f) => ({
        status: f.status,
        // strip absolute path so snapshot is stable across machines
        testPath: f.testPath.split('/').pop(),
      })),
      unhandledErrors: result.unhandledErrors,
      duration: { hasTotal: typeof result.duration.totalTime === 'number' },
      snapshotPresent: typeof result.snapshotSummary === 'object',
      buildFailure: buildFailureResult,
    })}__END__`,
  );
} finally {
  await rm(discoveredConfig, { force: true });
}
