import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pathe from 'pathe';
import {
  filterFiles,
  filterProjects,
  formatTestEntryName,
  getTestEntries,
} from '../../src/utils/testFiles';

describe('test filterFiles', () => {
  it('should filter files correctly', () => {
    const testFiles = ['index.test.ts', 'index1.test.ts', 'index2.test.ts'].map(
      (filename) => path.join(__dirname, filename),
    );

    expect(filterFiles(testFiles, ['index.test.ts'], __dirname)).toEqual([
      testFiles[0],
    ]);

    expect(
      filterFiles(
        testFiles,
        [path.join(__dirname, 'index.test.ts')],
        __dirname,
      ),
    ).toEqual([testFiles[0]]);

    expect(filterFiles(testFiles, ['index'], __dirname)).toEqual(testFiles);
  });
});

test('formatTestEntryName', () => {
  expect(formatTestEntryName('../setup.ts')).toBe('_setup~ts');
  expect(formatTestEntryName('setup.ts')).toBe('setup~ts');
  expect(formatTestEntryName('some.setup.ts')).toBe('some~setup~ts');
  expect(formatTestEntryName('some/setup.ts')).toBe('some_setup~ts');
});

describe('getTestEntries literal/glob handling', () => {
  let rootPath: string;
  let cleanup: string;

  beforeEach(() => {
    rootPath = mkdtempSync(path.join(tmpdir(), 'rstest-entries-'));
    cleanup = rootPath;
  });

  afterEach(() => {
    rmSync(cleanup, { recursive: true, force: true });
  });

  const baseArgs = (projectRoot: string) => ({
    exclude: [],
    includeSource: [],
    fileFilters: [],
    rootPath: projectRoot,
    projectRoot,
  });

  test('literal include without fs file is preserved (virtual entry contract)', async () => {
    const virtualName = 'virtual/login.yaml.test.ts';
    const entries = await getTestEntries({
      ...baseArgs(rootPath),
      include: [virtualName],
    });
    const values = Object.values(entries);
    expect(values).toHaveLength(1);
    expect(pathe.normalize(values[0])).toBe(
      pathe.join(pathe.normalize(rootPath), virtualName),
    );
  });

  test('absolute literal include is preserved without fs check', async () => {
    const absVirtual = pathe.join(
      pathe.normalize(rootPath),
      'absolute.virtual.test.ts',
    );
    const entries = await getTestEntries({
      ...baseArgs(rootPath),
      include: [absVirtual],
    });
    expect(Object.values(entries)).toEqual([absVirtual]);
  });

  test('glob include still filters by fs existence', async () => {
    writeFileSync(path.join(rootPath, 'real.test.ts'), 'export {}');
    const entries = await getTestEntries({
      ...baseArgs(rootPath),
      include: ['*.test.ts'],
    });
    expect(Object.values(entries)).toEqual([
      pathe.join(pathe.normalize(rootPath), 'real.test.ts'),
    ]);
  });

  test('literal + glob are merged and deduplicated', async () => {
    mkdirSync(path.join(rootPath, 'src'), { recursive: true });
    writeFileSync(path.join(rootPath, 'src', 'a.test.ts'), 'export {}');
    writeFileSync(path.join(rootPath, 'src', 'b.test.ts'), 'export {}');

    const entries = await getTestEntries({
      ...baseArgs(rootPath),
      include: [
        'src/**/*.test.ts', // glob, matches a + b
        'src/a.test.ts', // literal duplicate of glob hit
        'virtual/c.test.ts', // literal virtual entry
      ],
    });

    const sortedValues = Object.values(entries).sort();
    expect(sortedValues).toEqual(
      [
        pathe.join(pathe.normalize(rootPath), 'src', 'a.test.ts'),
        pathe.join(pathe.normalize(rootPath), 'src', 'b.test.ts'),
        pathe.join(pathe.normalize(rootPath), 'virtual', 'c.test.ts'),
      ].sort(),
    );
  });

  test('glob exclude applies to a literal include pointing to a real file', async () => {
    mkdirSync(path.join(rootPath, 'generated'), { recursive: true });
    writeFileSync(path.join(rootPath, 'generated', 'foo.test.ts'), 'export {}');

    const entries = await getTestEntries({
      ...baseArgs(rootPath),
      include: ['generated/foo.test.ts'], // literal, real file on disk
      exclude: ['**/generated/**'], // glob exclude that matches it
    });

    // The real file must be filtered by the glob `exclude`, exactly as it would
    // be for a glob include. (Virtual literals — absent from disk — still pass.)
    expect(Object.values(entries)).toEqual([]);
  });
});

test('filterProjects', () => {
  const projects = [
    {
      config: { name: '@rstest/core' },
      relativeRoot: 'packages/core',
    },
    {
      config: { name: '@rstest/coverage' },
      relativeRoot: 'packages/coverage',
    },
    {
      config: { name: 'react' },
      relativeRoot: 'example/react',
    },
  ];

  expect(filterProjects(projects, {})).toEqual(projects);

  expect(
    filterProjects(projects, {
      project: ['@rstest/core'],
    }),
  ).toEqual([
    {
      config: { name: '@rstest/core' },
      relativeRoot: 'packages/core',
    },
  ]);

  expect(
    filterProjects(projects, {
      project: ['@rstest/*'],
    }),
  ).toEqual([
    {
      config: { name: '@rstest/core' },
      relativeRoot: 'packages/core',
    },
    {
      config: { name: '@rstest/coverage' },
      relativeRoot: 'packages/coverage',
    },
  ]);

  expect(
    filterProjects(projects, {
      project: ['!@rstest/*'],
    }),
  ).toEqual([
    {
      config: { name: 'react' },
      relativeRoot: 'example/react',
    },
  ]);
});
