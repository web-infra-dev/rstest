import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@rstest/core';
import { createRstest } from '@rstest/core/api';

const cwd = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../projects/fixtures-duplicate-names',
);
const config = await loadConfig({ cwd });
config.content.reporters = [];
const rstest = await createRstest({ cwd, config });
const selected = await rstest.run({ project: ['alpha'] });
let error;
try {
  await rstest.run();
} catch (cause) {
  error = String(cause);
}
console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    status: selected.status,
    passed: selected.summary.tests.passed,
    error,
  })}__END__`,
);
