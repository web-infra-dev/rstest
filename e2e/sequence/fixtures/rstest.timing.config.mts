import { defineConfig } from '@rstest/core';

export default defineConfig({
  reporters: [
    'default',
    {
      onTestFileResult({ testPath, status, loadDuration, duration }) {
        console.log(
          `TIMING:${JSON.stringify({ testPath, status, loadDuration, duration })}`,
        );
      },
    },
  ],
});
