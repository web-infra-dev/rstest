import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const root = join(fixtureDir, `.list-${process.pid}`);

for (const project of ['alpha', 'beta']) {
  const projectRoot = join(root, project);
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    join(projectRoot, `${project}.test.ts`),
    `
import { describe, expect, it } from '@rstest/core';

describe('shared suite', () => {
  it('shared case', () => {
    expect(${JSON.stringify(project)}).toBe(${JSON.stringify(project)});
  });
});
`,
  );
}

try {
  const rstest = await createRstest({
    cwd: root,
    config: {
      reporters: [],
      projects: ['alpha', 'beta'].map((name) => ({
        name,
        root: `./${name}`,
        include: [`${name}.test.ts`],
      })),
    },
  });
  const listed = await rstest.listTests({
    includeSuites: true,
    printLocation: true,
    shard: { index: 1, count: 2 },
  });
  const files = await rstest.listTests({
    filesOnly: true,
    shard: '2/2',
  });
  const filtered = await rstest.listTests({
    filesOnly: true,
    filters: ['alpha/alpha.test.ts'],
    filterMode: 'exact',
  });
  const skippedRoot = join(root, 'skipped');
  await mkdir(skippedRoot);
  await writeFile(
    join(skippedRoot, 'only-skipped.test.ts'),
    `
import { it } from '@rstest/core';

it.skip('skipped case', () => {});
`,
  );
  await writeFile(
    join(skippedRoot, 'todo.test.ts'),
    `
import { it } from '@rstest/core';

it.todo('todo case');
`,
  );
  const skippedRstest = await createRstest({
    cwd: skippedRoot,
    config: {
      include: ['*.test.ts'],
      reporters: [],
    },
  });
  const skippedDeclarations = await skippedRstest.listTests();
  const brokenRoot = join(root, 'broken');
  await mkdir(brokenRoot);
  await writeFile(
    join(brokenRoot, 'broken.test.ts'),
    `throw new Error('collection failed intentionally');\n`,
  );
  const brokenRstest = await createRstest({
    cwd: brokenRoot,
    config: {
      include: ['broken.test.ts'],
      reporters: [],
    },
  });
  let collectionError;
  try {
    await brokenRstest.listTests();
  } catch (error) {
    collectionError = error.message;
  }

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      context: {
        rootMatches: rstest.context.root === root,
        projects: rstest.context.projects.map((project) => ({
          ...project,
          root: project.root.split('/').pop(),
        })),
      },
      listed: listed.map((test) => ({
        ...test,
        file: test.file.split('/').pop(),
        location: test.location
          ? {
              line: test.location.line,
              column: test.location.column,
            }
          : undefined,
      })),
      files: files.map((test) => ({
        ...test,
        file: test.file.split('/').pop(),
      })),
      filtered: filtered.map((test) => test.file.split('/').pop()),
      skippedDeclarations: skippedDeclarations.map((test) => ({
        ...test,
        file: test.file.split('/').pop(),
      })),
      collectionError,
    })}__END__`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
