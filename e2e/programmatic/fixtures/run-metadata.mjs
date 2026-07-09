import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');
let reporterFileMeta;
const reporterCaseMeta = [];
const suiteMeta = [];

const result = await runRstest({
  cwd,
  inlineConfig: {
    include: ['sum.test.ts'],
    reporters: [
      {
        onTestSuiteResult(result) {
          if (result.name === 'disk sum') {
            suiteMeta.push(result.meta);
          }
        },
        onTestCaseResult(result) {
          reporterCaseMeta.push(result.meta);
        },
        onTestFileResult(result) {
          reporterFileMeta = result.meta;
        },
      },
    ],
  },
});

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    fileMeta: result.files[0]?.meta,
    caseMeta: result.files[0]?.results.map((r) => r.meta),
    reporterFileMeta,
    reporterCaseMeta,
    suiteMeta,
  })}__END__`,
);
