import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, onTestFinished } from '@rstest/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const checker = join(__dirname, '../../scripts/harness/check-harness-docs.mjs');

const createFixture = async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'rstest-harness-'));
  onTestFinished(() => rm(cwd, { recursive: true, force: true }));

  const files = {
    'package.json': JSON.stringify({ name: 'harness-fixture', private: true }),
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'AGENTS.md': [
      '# Fixture',
      '',
      '## Sub-package Instructions',
      '- `packages/example/AGENTS.md`',
      '',
      '## Monorepo structure',
      '- `packages/example/`',
      '',
    ].join('\n'),
    'packages/example/package.json': JSON.stringify({
      name: '@fixture/example',
      scripts: { dev: 'echo dev' },
      dependencies: { '@fixture/present': '1.0.0' },
    }),
    'packages/example/AGENTS.md': '# Example\n',
    'packages/example/docs/AGENTS.md': '# Nested documentation\n',
    'packages/example/src/exists.ts': 'export {};\n',
  };

  for (const [file, content] of Object.entries(files)) {
    const path = join(cwd, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd });
  return cwd;
};

const check = (cwd: string) => {
  const result = spawnSync(process.execPath, [checker, '--json'], {
    cwd,
    encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  return { status: result.status, violations: JSON.parse(result.stdout) };
};

it('resolves scripts from the owning package of direct and nested docs', async () => {
  const cwd = await createFixture();
  for (const doc of [
    'packages/example/AGENTS.md',
    'packages/example/docs/AGENTS.md',
  ]) {
    await writeFile(join(cwd, doc), '```bash\npnpm dev\nnpm run dev\n```\n');
  }

  expect(check(cwd)).toEqual({ status: 0, violations: [] });
});

it('checks package-relative paths in nested docs', async () => {
  const cwd = await createFixture();
  const doc = 'packages/example/docs/AGENTS.md';
  await writeFile(join(cwd, doc), '`src/exists.ts`\n');
  expect(check(cwd)).toEqual({ status: 0, violations: [] });

  await writeFile(join(cwd, doc), '`src/missing.ts`\n');
  expect(check(cwd)).toEqual({
    status: 1,
    violations: [
      expect.objectContaining({
        check: 'C3',
        file: doc,
        token: 'src/missing.ts',
      }),
    ],
  });

  await writeFile(join(cwd, doc), '`src/exists.ts`\n');
  expect(check(cwd)).toEqual({ status: 0, violations: [] });
});

it('checks dependency declarations in nested docs', async () => {
  const cwd = await createFixture();
  const doc = 'packages/example/docs/AGENTS.md';
  await writeFile(join(cwd, doc), '## Dependencies\n\n`@fixture/present`\n');
  expect(check(cwd)).toEqual({ status: 0, violations: [] });

  await writeFile(join(cwd, doc), '## Dependencies\n\n`@fixture/absent`\n');
  expect(check(cwd)).toEqual({
    status: 1,
    violations: [
      expect.objectContaining({
        check: 'C4',
        file: doc,
        token: '@fixture/absent',
      }),
    ],
  });

  await writeFile(join(cwd, doc), '## Dependencies\n\n`@fixture/present`\n');
  expect(check(cwd)).toEqual({ status: 0, violations: [] });
});

it('still rejects missing scripts in root and package docs', async () => {
  const cwd = await createFixture();
  await writeFile(join(cwd, 'AGENTS.md'), '\n```bash\npnpm missing\n```\n', {
    flag: 'a',
  });
  await writeFile(
    join(cwd, 'packages/example/AGENTS.md'),
    '```bash\nnpm run missing\n```\n',
  );

  expect(check(cwd)).toEqual({
    status: 1,
    violations: [
      expect.objectContaining({
        check: 'C2',
        file: 'AGENTS.md',
        token: 'pnpm missing',
      }),
      expect.objectContaining({
        check: 'C2',
        file: 'packages/example/AGENTS.md',
        token: 'npm run missing',
      }),
    ],
  });
});
