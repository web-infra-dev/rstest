import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const cwd = join(fixtureDir, 'disk');
const rstest = await createRstest({
  cwd,
  config: {
    reporters: ['default'],
    projects: [
      { name: 'project-a', include: ['sum.test.ts'] },
      { name: 'project-b', include: ['sum.test.ts'] },
    ],
  },
});
const result = await rstest.run();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    status: result.status,
    summary: result.summary,
    results: result.results.map(({ project, testPath }) => ({
      project,
      testPath: testPath.split('/').pop(),
    })),
  })}__END__`,
);
