import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { groupProjectEntriesByEnvironment } from '../../src/core/environmentGroups';
import type { ProjectContext } from '../../src/types';
import {
  applyEnvironmentPragma,
  parseEnvironmentPragma,
  parseEnvironmentPragmaFromFile,
} from '../../src/utils/environmentPragmas';

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

describe('environment pragmas', () => {
  it('parses rstest environment and options pragmas', () => {
    expect(
      parseEnvironmentPragma(`/**
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
    expect(parseEnvironmentPragma('// @vitest-environment happy-dom')).toEqual({
      name: 'happy-dom',
    });
    expect(parseEnvironmentPragma('// @jest-environment node')).toEqual({
      name: 'node',
    });
  });

  it('merges options when pragma keeps the base environment', () => {
    expect(
      applyEnvironmentPragma(
        {
          name: 'jsdom',
          options: {
            url: 'https://base.test/',
            pretendToBeVisual: true,
          },
        },
        {
          options: {
            url: 'https://pragma.test/',
          },
        },
      ),
    ).toEqual({
      name: 'jsdom',
      options: {
        url: 'https://pragma.test/',
        pretendToBeVisual: true,
      },
    });
  });

  it('rejects unsupported environments', () => {
    expect(() =>
      parseEnvironmentPragma('// @rstest-environment custom', 'custom.test.ts'),
    ).toThrow(
      'Unsupported test environment "custom" in custom.test.ts. Supported environments: node, jsdom, happy-dom.',
    );
  });

  it('rejects invalid options json with file path', () => {
    expect(() =>
      parseEnvironmentPragma(
        '// @rstest-environment-options { invalid }',
        'invalid.test.ts',
      ),
    ).toThrow(/Failed to parse test environment options in invalid\.test\.ts/);
  });

  it('reads pragmas from the file head', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-pragma-'));
    try {
      const file = path.join(root, 'index.test.ts');
      writeFileSync(file, '// @rstest-environment jsdom\n');
      await expect(parseEnvironmentPragmaFromFile(file)).resolves.toEqual({
        name: 'jsdom',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores virtual entries without physical files', async () => {
    await expect(
      parseEnvironmentPragmaFromFile('/virtual/missing.test.ts'),
    ).resolves.toBeNull();
  });

  it('preserves global setup claims across synthetic environment groups', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-pragma-'));
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
});
