import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'runner');

// Counts real compilations: the dev-compile hook fires once per compilation, so
// a second `run()` that recompiled the built set would bump it. Reusing the
// same counter for a second runner below is the positive control — it proves
// the counter still moves, so "unchanged across two runs" cannot pass because
// the hook was never wired up.
let compiles = 0;
const countCompiles = {
  name: 'e2e-count-compiles',
  setup(api) {
    api.onAfterDevCompile(() => {
      compiles += 1;
    });
  },
};

const config = {
  include: ['*.test.ts'],
  reporters: [],
  plugins: [countCompiles],
};

const rstest = await createRstest({ cwd, config });
const runner = await rstest.createRunner();

const build = await runner.build();

const first = await runner.run();
const compilesAfterFirstRun = compiles;

const second = await runner.run();
const compilesAfterSecondRun = compiles;

await runner.close();

// A second runner over the same config compiles its own build.
const secondRunner = await rstest.createRunner();
const third = await secondRunner.run();
const compilesAfterSecondRunner = compiles;
await secondRunner.close();

const summarize = (result) => ({
  ok: result.ok,
  stats: result.stats,
});

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    // Absolute paths of what the build compiled; stripped to basenames so the
    // assertion is stable across machines.
    buildFiles: build.testFiles.map((file) => file.split('/').pop()).sort(),
    buildFilesAbsolute: build.testFiles.every((file) => isAbsolute(file)),
    compilesAfterFirstRun,
    compilesAfterSecondRun,
    compilesAfterSecondRunner,
    first: summarize(first),
    second: summarize(second),
    third: summarize(third),
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
