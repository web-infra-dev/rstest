import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const tools = {
  rspack(_config, { appendPlugins }) {
    appendPlugins({
      apply(compiler) {
        compiler.hooks.afterCompile.tap('compile-failed', () => {
          throw new Error('compile exploded');
        });
      },
    });
  },
};
const rstest = await createRstest({
  cwd: fixtureDir,
  config: {
    reporters: [],
    projects: ['first', 'second'].map((name) => ({
      name,
      include: ['disk/sum.test.ts'],
      tools,
    })),
  },
});

const result = await rstest.run();
// A fatal compile failure leaves no watcher to retry with: watch() reports
// the cycle through onResult, then rejects.
const cycles = [];
let watchRejection;
try {
  await rstest.watch({
    onResult(result) {
      cycles.push({
        status: result.status,
        errors: result.unhandledErrors.map((error) => error.message),
      });
    },
  });
} catch (error) {
  watchRejection = error.message;
}
console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    status: result.status,
    errors: result.unhandledErrors.map((error) => error.message),
    cycles,
    watchRejection,
  })}__END__`,
);
