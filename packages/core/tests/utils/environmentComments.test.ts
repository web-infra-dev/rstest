import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { groupProjectEntriesByEnvironment } from '../../src/core/environmentGroups';
import type { ProjectContext } from '../../src/types';
import {
  applyEnvironmentComment,
  parseEnvironmentComment,
  parseEnvironmentCommentFromFile,
} from '../../src/utils/environmentComments';

const fixturesRoot = path.join(process.cwd(), 'packages/core/tests/fixtures');

const createProject = (): ProjectContext => ({
  name: 'default',
  environmentName: 'default',
  rootPath: fixturesRoot,
  outputModule: true,
  _globalSetups: false,
  normalizedConfig: {
    name: 'default',
    root: fixturesRoot,
    setupFiles: [],
    globalSetup: ['./global-setup.ts'],
    testEnvironment: {
      name: 'node',
    },
    browser: {
      enabled: false,
    },
  } as ProjectContext['normalizedConfig'],
});

describe('environment comments', () => {
  it('parses rstest environment and options comments', () => {
    expect(
      parseEnvironmentComment(`/**
 * @rstest-environment jsdom
 * @rstest-environment-options { "url": "https://example.test/" }
 */`),
    ).toEqual({
      name: 'jsdom',
      options: {
        url: 'https://example.test/',
      },
    });
  });

  it('parses vitest and jest aliases', () => {
    expect(parseEnvironmentComment('// @vitest-environment happy-dom')).toEqual(
      {
        name: 'happy-dom',
      },
    );
    expect(parseEnvironmentComment('// @jest-environment node')).toEqual({
      name: 'node',
    });
  });

  it('ignores environment markers inside code strings', () => {
    expect(
      parseEnvironmentComment(`
const packageName = '@rstest/core';
describe('resolveTestEnvironmentFromTarget', () => {});
const jsdom = '// @rstest-environment jsdom';
`),
    ).toBeNull();
  });

  it('keeps reading comments after regex literals with quotes', () => {
    expect(
      parseEnvironmentComment(`
const regexp = /"/;
// @rstest-environment jsdom
`),
    ).toEqual({
      name: 'jsdom',
    });
  });

  it('parses CRLF line comments without a final newline', () => {
    expect(
      parseEnvironmentComment(
        '// @rstest-environment jsdom\r\n// @rstest-environment-options { "url": "https://example.test/" }\r',
      ),
    ).toEqual({
      name: 'jsdom',
      options: {
        url: 'https://example.test/',
      },
    });
  });

  it('merges options when comment keeps the base environment', () => {
    expect(
      applyEnvironmentComment(
        {
          name: 'jsdom',
          options: {
            url: 'https://base.test/',
            pretendToBeVisual: true,
          },
        },
        {
          options: {
            url: 'https://comment.test/',
          },
        },
      ),
    ).toEqual({
      name: 'jsdom',
      options: {
        url: 'https://comment.test/',
        pretendToBeVisual: true,
      },
    });
  });

  it('rejects unsupported environments', () => {
    expect(() =>
      parseEnvironmentComment(
        '// @rstest-environment custom',
        'custom.test.ts',
      ),
    ).toThrow(
      'Unsupported test environment "custom" in custom.test.ts. Supported environments: node, jsdom, happy-dom.',
    );
  });

  it('rejects invalid options json with file path', () => {
    expect(() =>
      parseEnvironmentComment(
        '// @rstest-environment-options { invalid }',
        'invalid.test.ts',
      ),
    ).toThrow(/Failed to parse test environment options in invalid\.test\.ts/);
  });

  it('reads comments from the file head', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const file = path.join(root, 'index.test.ts');
      writeFileSync(file, '// @rstest-environment jsdom\n');
      await expect(parseEnvironmentCommentFromFile(file)).resolves.toEqual({
        name: 'jsdom',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores virtual entries without physical files', async () => {
    await expect(
      parseEnvironmentCommentFromFile('/virtual/missing.test.ts'),
    ).resolves.toBeNull();
  });

  it('preserves global setup claims across synthetic environment groups', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'node.test.ts');
      const jsdomFile = path.join(root, 'jsdom.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');

      const project = createProject();
      project._globalSetups = true;

      const grouped = await groupProjectEntriesByEnvironment({
        entriesCache: new Map([
          [
            project.environmentName,
            {
              entries: {
                node: nodeFile,
                jsdom: jsdomFile,
              },
            },
          ],
        ]),
        projects: [project],
      });

      expect(grouped.changed).toBe(true);
      expect(grouped.projects).toHaveLength(2);
      expect(grouped.projects.every((item) => item._globalSetups)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves the base project name for files without environment comments', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'node.test.ts');
      const jsdomFile = path.join(root, 'jsdom.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');

      const project = createProject();

      const grouped = await groupProjectEntriesByEnvironment({
        entriesCache: new Map([
          [
            project.environmentName,
            {
              entries: {
                node: nodeFile,
                jsdom: jsdomFile,
              },
            },
          ],
        ]),
        projects: [project],
      });

      expect(grouped.changed).toBe(true);
      expect(grouped.projects.map((item) => item.name)).toEqual([
        'default',
        'default-environment-1',
      ]);
      expect(grouped.projects.map((item) => item.environmentName)).toEqual([
        'default',
        'default-environment-1',
      ]);
      expect(grouped.entriesCache.get('default')?.entries).toEqual({
        node: nodeFile,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not split projects when environment markers only appear in code strings', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const file = path.join(root, 'code-string.test.ts');
      writeFileSync(
        file,
        `const packageName = '@rstest/core';
describe('resolveTestEnvironmentFromTarget', () => {});
const jsdom = '// @rstest-environment jsdom';
`,
      );

      const project = createProject();

      const grouped = await groupProjectEntriesByEnvironment({
        entriesCache: new Map([
          [
            project.environmentName,
            {
              entries: {
                file,
              },
            },
          ],
        ]),
        projects: [project],
      });

      expect(grouped.changed).toBe(false);
      expect(grouped.projects).toEqual([project]);
      expect(
        grouped.entriesCache.get(project.environmentName)?.entries,
      ).toEqual({
        file,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
