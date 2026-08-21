import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';
import { loadConfig } from '@rstest/core';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const root = join(fixtureDir, `.config-factory-${process.pid}`);
const extendsLog = join(root, 'extends.log');
let factoryCalls = 0;

await mkdir(root, { recursive: true });
await writeFile(
  join(root, 'factory.test.ts'),
  `
import { expect, it } from '@rstest/core';

it('loads a disk config through the factory', () => {
  expect(21 * 2).toBe(42);
});
`,
);
await writeFile(
  join(root, 'rstest.config.mjs'),
  `
import { appendFileSync } from 'node:fs';

export default {
  extends: () => {
    appendFileSync(${JSON.stringify(extendsLog)}, 'resolved\\n');
    return { include: ['factory.test.ts'] };
  },
  reporters: [],
};
`,
);

try {
  const rstest = await createRstest({
    cwd: root,
    config: async () => {
      factoryCalls += 1;
      return (await loadConfig({ cwd: root })).content;
    },
  });
  const result = await rstest.run();
  const extendsEntries = (await readFile(extendsLog, 'utf8'))
    .trim()
    .split('\n')
    .filter((entry) => entry === 'resolved');

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      ok: result.ok,
      tests: result.stats.tests.total,
      factoryCalls,
      extendsCalls: extendsEntries.length,
    })}__END__`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
