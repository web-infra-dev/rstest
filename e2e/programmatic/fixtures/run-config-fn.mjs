import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'config-fn');

// Function-form `config`: the callback receives the resolved disk config and
// returns the final config — here it narrows `include` from two files to one.
const rstest = await createRstest({
  cwd,
  configFile: 'rstest.config.ts',
  config: (loaded) => {
    // Prove the disk config was loaded and handed in before transforming it.
    if (!loaded.include?.includes('b.test.ts')) {
      throw new Error(
        `config callback did not receive disk config; got include=${JSON.stringify(loaded.include)}`,
      );
    }
    return { ...loaded, include: ['a.test.ts'] };
  },
});
const result = await rstest.run();
await rstest.close();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    files: result.files
      .map((f) => ({ status: f.status, testPath: f.testPath.split('/').pop() }))
      .sort((a, b) => a.testPath.localeCompare(b.testPath)),
  })}__END__`,
);
