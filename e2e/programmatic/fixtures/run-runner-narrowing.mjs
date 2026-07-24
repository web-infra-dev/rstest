import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'runner');

// One build (alpha.test.ts: `adds` + `multiplies`, beta.test.ts: `subtracts`),
// then several runs that each select a different subset of it.
const rstest = await createRstest({
  cwd,
  config: { include: ['*.test.ts'], reporters: [] },
});
const runner = await rstest.createRunner();

const all = await runner.run();
const byFile = await runner.run({ filters: ['alpha.test.ts'] });
const byName = await runner.run({ testNamePattern: 'adds' });
// `gamma.test.ts` is not in the built set, so a run-scoped filter for it can
// only narrow to nothing — it never widens the build.
const outsideBuild = await runner.run({ filters: ['gamma.test.ts'] });
const outsideBuildAllowed = await runner.run({
  filters: ['gamma.test.ts'],
  passWithNoTests: true,
});

await runner.close();

const summarize = (result) => ({
  ok: result.ok,
  stats: result.stats,
  files: result.files.map((file) => file.testPath.split('/').pop()).sort(),
  passed: result.files
    .flatMap((file) => file.results)
    .filter((test) => test.status === 'pass')
    .map((test) => test.name)
    .sort(),
});

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    all: summarize(all),
    byFile: summarize(byFile),
    byName: summarize(byName),
    outsideBuild: summarize(outsideBuild),
    outsideBuildAllowed: summarize(outsideBuildAllowed),
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
