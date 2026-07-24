import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Generated because this fixture edits its own source between builds;
// `test-temp-*` is gitignored and excluded from the e2e tsconfig.
const cwd = join(__dirname, 'test-temp-rebuild');
rmSync(cwd, { recursive: true, force: true });
mkdirSync(cwd, { recursive: true });

const valueFile = join(cwd, 'value.ts');
writeFileSync(valueFile, "export const value = 'first';\n");
writeFileSync(
  join(cwd, 'value.test.ts'),
  [
    "import { it } from '@rstest/core';",
    "import { value } from './value';",
    '',
    "it('reports the compiled source value', (ctx) => {",
    '  ctx.task.meta = { ...ctx.task.meta, value };',
    '});',
    '',
  ].join('\n'),
);

const rstest = await createRstest({
  cwd,
  config: { include: ['*.test.ts'], reporters: [] },
});

const observedValues = (result) =>
  result.files.flatMap((file) => file.results).map((test) => test.meta?.value);

const runner = await rstest.createRunner();

const firstBuild = await runner.build();
const first = await runner.run();

// The compiled output is fixed for the runner's lifetime: build() is
// re-entrant but resolves the same build, and a source edit made afterwards is
// not picked up.
writeFileSync(valueFile, "export const value = 'second';\n");
const secondBuild = await runner.build();
const second = await runner.run();

await runner.close();

// The edit was real — a new runner compiles it. This is the documented way to
// pick up source changes.
const freshRunner = await rstest.createRunner();
const third = await freshRunner.run();
await freshRunner.close();

const basenames = (files) => files.map((file) => file.split('/').pop()).sort();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    firstBuildFiles: basenames(firstBuild.testFiles),
    secondBuildFiles: basenames(secondBuild.testFiles),
    firstValues: observedValues(first),
    secondValues: observedValues(second),
    thirdValues: observedValues(third),
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
