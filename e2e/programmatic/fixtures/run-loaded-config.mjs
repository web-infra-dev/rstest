import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';
import { loadConfig } from '@rstest/core';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const root = join(fixtureDir, `.loaded-config-${process.pid}`);
const extendsLog = join(root, 'extends.log');

await mkdir(root, { recursive: true });
const emptyConfig = await loadConfig({ cwd: root });
await writeFile(
  join(root, 'shared.mjs'),
  "export const include = ['loaded.test.ts'];",
);
await writeFile(
  join(root, 'loaded.test.ts'),
  `
import { expect, it } from '@rstest/core';

it('loads a disk config', () => {
  expect(21 * 2).toBe(42);
});
`,
);
await writeFile(
  join(root, 'rstest.config.mjs'),
  `
import { appendFileSync } from 'node:fs';
import { include } from './shared.mjs';

export default {
  extends: () => {
    appendFileSync(${JSON.stringify(extendsLog)}, 'resolved\\n');
    return { include };
  },
  reporters: [],
};
`,
);

try {
  const loaded = await loadConfig({ cwd: root });
  const rstest = await createRstest({
    cwd: root,
    config: loaded,
  });
  const result = await rstest.run();
  const extendsEntries = (await readFile(extendsLog, 'utf8'))
    .trim()
    .split('\n')
    .filter((entry) => entry === 'resolved');

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      status: result.status,
      tests: result.summary.tests.total,
      extendsCalls: extendsEntries.length,
      emptyConfig,
      dependencies: loaded.dependencies?.map((file) => relative(root, file)),
    })}__END__`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
