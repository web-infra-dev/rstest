import { createServer } from 'node:net';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  teardownTimeout:
    process.env.EXIT_TIMEOUT === undefined
      ? undefined
      : Number(process.env.EXIT_TIMEOUT),
  globalSetup: process.env.TEARDOWN_MARKER ? ['./globalSetup.ts'] : [],
  reporters: [
    {
      onTestRunEnd() {
        if (process.env.LEAK_SOCKET === 'true') {
          createServer().listen(0);
        }
        if (process.env.LARGE_OUTPUT === 'true') {
          for (let index = 0; index < 1024; index++) {
            process.stdout.write(`OUTPUT:${index}:${'x'.repeat(1024)}\n`);
          }
        }
      },
      async onExit() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        process.stdout.write('REPORTER_EXIT_DONE\n');
      },
    },
  ],
});
