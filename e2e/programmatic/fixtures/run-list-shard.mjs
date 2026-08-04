import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

const rstest = await createRstest({
  cwd,
  config: {
    include: ['**/*.test.ts'],
    reporters: [],
  },
});

const fileCount = (results) => new Set(results.map((r) => r.testPath)).size;

const full = await rstest.listTests();
// `shard` is an execution-only option; listing must ignore it and still collect
// the full set of files rather than slicing them down to one shard.
const sharded = await rstest.listTests({ shard: '1/2' });

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    fullFiles: fileCount(full),
    shardedFiles: fileCount(sharded),
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
