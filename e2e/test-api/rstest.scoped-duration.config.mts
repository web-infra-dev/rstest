import type { Reporter, TestFileResult } from '@rstest/core';
import { defineConfig } from '@rstest/core';

class DurationReporter implements Reporter {
  onTestFileResult(result: TestFileResult) {
    console.log(`SCOPED_FILE_DURATION=${result.duration}`);
  }
}

export default defineConfig({
  include: ['fixtures/fileFixtureDuration.test.ts'],
  reporters: [new DurationReporter()],
});
