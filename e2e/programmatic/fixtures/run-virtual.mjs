import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRstest } from '@rstest/core/api';
import { rspack } from '@rsbuild/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

const virtualTests = {
  'virtual/programmatic.test.ts': `
import { describe, expect, it } from '@rstest/core';

let runs = 0;

describe('programmatic virtual', () => {
  it('inline + virtual entry works', ({ task }) => {
    task.meta.runs = ++runs;
    expect(2 * 3).toBe(6);
  });
});
`,
};

const rstest = await createRstest({
  cwd: __dirname,
  config: {
    repeats: 2,
    include: Object.keys(virtualTests),
    reporters: [],
    tools: {
      rspack: (_config, { appendPlugins }) => {
        appendPlugins(
          new rspack.experiments.VirtualModulesPlugin(virtualTests),
        );
      },
    },
  },
});
const result = await rstest.run({ repeats: 3 });
const noRepeats = await rstest.run({ repeats: 0 });
const configuredRepeats = await rstest.run();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    repeatRuns: [result, noRepeats, configuredRepeats].map((run) => ({
      status: run.status,
      runs: run.testResults[0].meta.runs,
    })),
    status: result.status,
    summary: result.summary,
    results: result.results.map((f) => ({
      status: f.status,
      testName: f.testPath.split('/').slice(-2).join('/'),
    })),
  })}__END__`,
);
