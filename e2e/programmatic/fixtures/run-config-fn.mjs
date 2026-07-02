import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@rstest/core';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'config-fn');

// Function-form `config`: a zero-arg factory that owns config loading. It reads
// the disk config itself via `loadConfig` (the programmatic API never reads one
// for you), then transforms it — here narrowing `include` from two files to one.
const rstest = await createRstest({
  cwd,
  config: async () => {
    const { content } = await loadConfig({ cwd, path: 'rstest.config.ts' });
    // Prove the disk config was loaded before transforming it.
    if (!content.include?.includes('b.test.ts')) {
      throw new Error(
        `config factory did not load the disk config; got include=${JSON.stringify(content.include)}`,
      );
    }
    return { ...content, include: ['a.test.ts'] };
  },
});
const result = await rstest.run();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    files: result.files
      .map((f) => ({ status: f.status, testPath: f.testPath.split('/').pop() }))
      .sort((a, b) => a.testPath.localeCompare(b.testPath)),
  })}__END__`,
);
