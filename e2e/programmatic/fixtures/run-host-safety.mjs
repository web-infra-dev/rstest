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
  PROGRAMMATIC_REUSED_ENV: 'host-stale',
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
  const initializedEnv = {
    RSTEST: process.env.RSTEST,
    NODE_ENV: process.env.NODE_ENV,
  };
  const [resultA, resultB] = await Promise.all([
    contextA.run(),
    contextB.run(),
  ]);
  clearInterval(probe);

  const reusedWorkerRoot = join(tempRoot, 'reused-worker-env');
  const projectAFinished = join(reusedWorkerRoot, 'project-a-finished');
  await mkdir(reusedWorkerRoot, { recursive: true });
  await writeFile(
    join(reusedWorkerRoot, 'projectA.setup.ts'),
    `
export default function globalSetup() {
  process.env.PROGRAMMATIC_REUSED_ENV = 'from-project-a';
}
`,
  );
  await writeFile(
    join(reusedWorkerRoot, 'projectB.setup.ts'),
    `
import { access } from 'node:fs/promises';

export default async function globalSetup() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await access(${JSON.stringify(projectAFinished)});
      delete process.env.PROGRAMMATIC_REUSED_ENV;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error('Timed out waiting for project A');
}
`,
  );
  await writeFile(
    join(reusedWorkerRoot, 'project-a.test.ts'),
    `
import { writeFileSync } from 'node:fs';
import { expect, it } from '@rstest/core';

it('sets env in the reusable worker', () => {
  expect(process.env.PROGRAMMATIC_REUSED_ENV).toBe('from-project-a');
  writeFileSync(${JSON.stringify(projectAFinished)}, String(process.pid));
});
`,
  );
  await writeFile(
    join(reusedWorkerRoot, 'project-b.test.ts'),
    `
import { readFileSync } from 'node:fs';
import { expect, it } from '@rstest/core';

it('observes the env deletion in the reused worker', () => {
  expect(readFileSync(${JSON.stringify(projectAFinished)}, 'utf8')).toBe(String(process.pid));
  expect(process.env.PROGRAMMATIC_REUSED_ENV).toBeUndefined();
});
`,
  );
  const reusedWorker = await createRstest({
    cwd: reusedWorkerRoot,
    config: {
      isolate: false,
      pool: { maxWorkers: 1 },
      reporters: [],
      projects: [
        {
          name: 'project-a',
          include: ['project-a.test.ts'],
          globalSetup: './projectA.setup.ts',
        },
        {
          name: 'project-b',
          include: ['project-b.test.ts'],
          globalSetup: './projectB.setup.ts',
        },
      ],
    },
  });
  const reusedWorkerResult = await reusedWorker.run();

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
      results: [resultA.status, resultB.status],
      initializedEnv,
      reusedWorkerDeletion: reusedWorkerResult.status === 'pass',
      observedMutations,
      successHostState,
      failure: {
        status: failureResult.status,
        summary: {
          tests: { failed: failureResult.summary.tests.failed },
          files: { failed: failureResult.summary.files.failed },
        },
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
  delete process.env.PROGRAMMATIC_REUSED_ENV;
  process.exitCode = 0;
  await rm(tempRoot, { recursive: true, force: true });
}
