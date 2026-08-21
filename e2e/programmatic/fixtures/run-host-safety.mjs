import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const tempRoot = join(fixtureDir, `.host-safety-${process.pid}`);
const teardownLog = join(tempRoot, 'teardown.log');
const hostEnv = {
  PROGRAMMATIC_CONTEXT_VALUE: 'host-value',
  PROGRAMMATIC_CONTEXT_DELETE: 'host-delete',
};

const createContextFixture = async (name) => {
  const root = join(tempRoot, name);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'globalSetup.ts'),
    `
import { appendFile } from 'node:fs/promises';

export default function globalSetup() {
  process.env.PROGRAMMATIC_CONTEXT_VALUE = ${JSON.stringify(name)};
  delete process.env.PROGRAMMATIC_CONTEXT_DELETE;
  return async () => {
    await appendFile(${JSON.stringify(teardownLog)}, ${JSON.stringify(`${name}\n`)});
  };
}
`,
  );
  await writeFile(
    join(root, 'index.test.ts'),
    `
import { expect, it } from '@rstest/core';

it('receives isolated global setup env', () => {
  expect(process.env.PROGRAMMATIC_CONTEXT_VALUE).toBe(${JSON.stringify(name)});
  expect(process.env.PROGRAMMATIC_CONTEXT_DELETE).toBeUndefined();
});
`,
  );
  return createRstest({
    cwd: root,
    config: {
      include: ['index.test.ts'],
      globalSetup: ['./globalSetup.ts'],
      reporters: [],
    },
  });
};

Object.assign(process.env, hostEnv);
process.exitCode = 9;
const observedMutations = [];
const probe = setInterval(() => {
  if (
    process.env.PROGRAMMATIC_CONTEXT_VALUE !==
      hostEnv.PROGRAMMATIC_CONTEXT_VALUE ||
    process.env.PROGRAMMATIC_CONTEXT_DELETE !==
      hostEnv.PROGRAMMATIC_CONTEXT_DELETE ||
    process.exitCode !== 9
  ) {
    observedMutations.push({
      value: process.env.PROGRAMMATIC_CONTEXT_VALUE,
      deleted: process.env.PROGRAMMATIC_CONTEXT_DELETE,
      exitCode: process.exitCode,
    });
  }
}, 1);

try {
  const [contextA, contextB] = await Promise.all([
    createContextFixture('context-a'),
    createContextFixture('context-b'),
  ]);
  const [resultA, resultB] = await Promise.all([
    contextA.run(),
    contextB.run(),
  ]);
  clearInterval(probe);

  const successHostState = {
    value: process.env.PROGRAMMATIC_CONTEXT_VALUE,
    deleted: process.env.PROGRAMMATIC_CONTEXT_DELETE,
    exitCode: process.exitCode,
  };

  process.exitCode = undefined;
  let failureExitCodeMutation = false;
  const failureProbe = setInterval(() => {
    if (process.exitCode !== undefined) {
      failureExitCodeMutation = true;
    }
  }, 1);
  const failing = await createRstest({
    cwd: join(fixtureDir, 'disk'),
    config: { include: ['failing.test.ts'], reporters: [] },
  });
  const failureResult = await failing.run();
  clearInterval(failureProbe);

  const teardownEntries = (await readFile(teardownLog, 'utf8'))
    .trim()
    .split('\n')
    .sort();

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      results: [resultA.ok, resultB.ok],
      observedMutations,
      successHostState,
      failure: {
        ok: failureResult.ok,
        hostExitCode: process.exitCode ?? 0,
        observedMutation: failureExitCodeMutation,
      },
      teardownEntries,
    })}__END__`,
  );
} finally {
  clearInterval(probe);
  delete process.env.PROGRAMMATIC_CONTEXT_VALUE;
  delete process.env.PROGRAMMATIC_CONTEXT_DELETE;
  process.exitCode = 0;
  await rm(tempRoot, { recursive: true, force: true });
}
