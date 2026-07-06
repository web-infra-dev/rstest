import type {
  Reporter,
  TestCaseInfo,
  TestFileResult,
  TestResult,
} from '@rstest/core';
import { defineConfig } from '@rstest/core';

const caseStartMeta: unknown[] = [];
const caseResultMeta: unknown[] = [];
const suiteResultMeta: unknown[] = [];
let fileResultMeta: unknown;

class MetadataReporter implements Reporter {
  onTestCaseStart(test: TestCaseInfo) {
    caseStartMeta.push({ name: test.name, meta: test.meta });
  }

  onTestCaseResult(result: TestResult) {
    caseResultMeta.push({ name: result.name, meta: result.meta });
  }

  onTestSuiteResult(result: TestResult) {
    if (result.name === 'metadata suite') {
      suiteResultMeta.push(result.meta);
    }
  }

  onTestFileResult(result: TestFileResult) {
    fileResultMeta = result.meta;
  }

  onTestRunEnd() {
    console.log(
      `__RSTEST_REPORTER_METADATA__${JSON.stringify({
        caseStartMeta,
        caseResultMeta,
        suiteResultMeta,
        fileResultMeta,
      })}__END__`,
    );
  }
}

export default defineConfig({
  include: ['fixtures/metadata.test.ts'],
  reporters: [new MetadataReporter()],
});
