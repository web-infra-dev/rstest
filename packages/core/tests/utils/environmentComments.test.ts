import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalize } from 'pathe';
import { groupProjectEntriesByEnvironment } from '../../src/core/environmentGroups';
import {
  createListProjectPlanState,
  createRunProjectPlanState,
} from '../../src/core/projectPlan';
import type { ProjectContext, RstestContext } from '../../src/types';
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

  it('marks only one synthetic environment group eligible for global setup', async () => {
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
      expect(grouped.projects).toHaveLength(2);
      expect(grouped.projects.map((item) => item._globalSetups)).toEqual([
        false,
        true,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the base environment group eligible for global setup regardless of file order', async () => {
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
                jsdom: jsdomFile,
                node: nodeFile,
              },
            },
          ],
        ]),
        projects: [project],
      });

      expect(grouped.changed).toBe(true);
      expect(
        grouped.projects.map((item) => ({
          environmentName: item.environmentName,
          globalSetupsClaimed: item._globalSetups,
        })),
      ).toEqual([
        {
          environmentName: 'default-environment-1',
          globalSetupsClaimed: true,
        },
        {
          environmentName: 'default',
          globalSetupsClaimed: false,
        },
      ]);
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

  it('creates a synthetic environment when all files override the environment', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const jsdomFile = path.join(root, 'jsdom.test.ts');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');

      const project = createProject();

      const grouped = await groupProjectEntriesByEnvironment({
        entriesCache: new Map([
          [
            project.environmentName,
            {
              entries: {
                jsdom: jsdomFile,
              },
            },
          ],
        ]),
        projects: [project],
      });

      expect(grouped.changed).toBe(true);
      expect(grouped.projects.map((item) => item.name)).toEqual([
        'default-environment-1',
      ]);
      expect(grouped.projects.map((item) => item.environmentName)).toEqual([
        'default-environment-1',
      ]);
      expect(grouped.projects[0]!.normalizedConfig.testEnvironment).toEqual({
        name: 'jsdom',
      });
      expect(
        grouped.entriesCache.get('default-environment-1')?.entries,
      ).toEqual({ jsdom: jsdomFile });
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

  it('refreshes environment partitions from the source project under shard', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'a.test.ts');
      const jsdomFile = path.join(root, 'b.test.ts');
      const newNodeFile = path.join(root, 'c.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');
      writeFileSync(newNodeFile, '// new node test\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['a.test.ts', 'b.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {
          shard: {
            index: 1,
            count: 1,
          },
        },
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await planState.resolveRunnableProjects();
      for (const item of context.projects) {
        item.normalizedConfig.include = ['a.test.ts', 'b.test.ts', 'c.test.ts'];
      }

      const refreshed = await planState.resolveRunnableProjects();

      expect(refreshed.entriesCache.get('default')?.entries).toEqual({
        'a~test~ts': normalize(nodeFile),
        'c~test~ts': normalize(newNodeFile),
      });
      expect(
        refreshed.entriesCache.get('default-environment-1')?.entries,
      ).toEqual({
        'b~test~ts': normalize(jsdomFile),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves a modified base environment when refreshing partitions', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'node.test.ts');
      const jsdomFile = path.join(root, 'jsdom.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['*.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {},
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await planState.resolveRunnableProjects();
      const baseProject = context.projects.find(
        (item) => item.environmentName === 'default',
      )!;
      baseProject.normalizedConfig.testEnvironment = { name: 'happy-dom' };

      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(
        refreshed.projects.find((item) => item.environmentName === 'default')
          ?.normalizedConfig.testEnvironment,
      ).toEqual({ name: 'happy-dom' });
      expect(refreshed.entriesCache.get('default')?.entries).toEqual({
        'node~test~ts': normalize(nodeFile),
      });
      expect(
        refreshed.entriesCache.get('default-environment-1')?.entries,
      ).toEqual({
        'jsdom~test~ts': normalize(jsdomFile),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps project names unique when refreshing renamed partitions', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const implicitJsdomFile = path.join(root, 'implicit-jsdom.test.ts');
      const initialNodeFile = path.join(root, 'initial-node.test.ts');
      const explicitJsdomFile = path.join(root, 'explicit-jsdom.test.ts');
      const explicitNodeFile = path.join(root, 'explicit-node.test.ts');
      writeFileSync(implicitJsdomFile, '// implicit jsdom test\n');
      writeFileSync(initialNodeFile, '// initial node test\n');
      writeFileSync(explicitJsdomFile, '// @rstest-environment jsdom\n');
      writeFileSync(explicitNodeFile, '// @rstest-environment node\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['initial-node.test.ts', 'explicit-jsdom.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {},
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await planState.resolveRunnableProjects();
      for (const item of context.projects) {
        item.normalizedConfig.include = [
          'implicit-jsdom.test.ts',
          'explicit-jsdom.test.ts',
          'explicit-node.test.ts',
        ];
        item.normalizedConfig.testEnvironment = { name: 'jsdom' };
      }

      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(
        refreshed.projects.map((item) => ({
          name: item.name,
          normalizedName: item.normalizedConfig.name,
          environmentName: item.environmentName,
          testEnvironment: item.normalizedConfig.testEnvironment,
        })),
      ).toEqual([
        {
          name: 'default-environment-1',
          normalizedName: 'default-environment-1',
          environmentName: 'default-environment-1',
          testEnvironment: { name: 'jsdom' },
        },
        {
          name: 'default-environment-2',
          normalizedName: 'default-environment-2',
          environmentName: 'default-environment-2',
          testEnvironment: { name: 'node' },
        },
      ]);
      expect(
        refreshed.entriesCache.get('default-environment-1')?.entries,
      ).toEqual({
        'explicit-jsdom~test~ts': normalize(explicitJsdomFile),
        'implicit-jsdom~test~ts': normalize(implicitJsdomFile),
      });
      expect(
        refreshed.entriesCache.get('default-environment-2')?.entries,
      ).toEqual({
        'explicit-node~test~ts': normalize(explicitNodeFile),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores invalid environment comments before config hooks can exclude them', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const invalidFile = path.join(root, 'invalid.test.ts');
      const validFile = path.join(root, 'valid.test.ts');
      writeFileSync(invalidFile, '// @rstest-environment custom\n');
      writeFileSync(validFile, '// valid test\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['*.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {},
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await expect(planState.resolveRunnableProjects()).resolves.toBeTruthy();
      context.projects[0]!.normalizedConfig.include = ['valid.test.ts'];

      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(refreshed.entriesCache.get('default')?.entries).toEqual({
        'valid~test~ts': normalize(validFile),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps browser entries when refreshing node environment partitions', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'node.test.ts');
      const jsdomFile = path.join(root, 'jsdom.test.ts');
      const browserFile = path.join(root, 'browser.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');
      writeFileSync(browserFile, '// @rstest-environment jsdom\n');

      const nodeProject: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['node.test.ts', 'jsdom.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const browserProject: ProjectContext = {
        ...createProject(),
        name: 'browser',
        environmentName: 'browser',
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          name: 'browser',
          root,
          include: ['browser.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
          browser: {
            enabled: true,
          },
        },
      };
      const context = {
        rootPath: root,
        projects: [browserProject, nodeProject],
        normalizedConfig: {},
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [browserProject],
        isWatchMode: false,
      });

      await planState.resolveRunnableProjects();
      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(refreshed.entriesCache.get('browser')?.entries).toEqual({
        'browser~test~ts': normalize(browserFile),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('recreates a missing base partition when refreshed entries need it', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'node.test.ts');
      const jsdomFile = path.join(root, 'jsdom.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['jsdom.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {
          shard: {
            index: 1,
            count: 1,
          },
        },
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await planState.resolveRunnableProjects();
      for (const item of context.projects) {
        item.normalizedConfig.include = ['node.test.ts', 'jsdom.test.ts'];
      }

      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(
        refreshed.projects.map((item) => item.environmentName).sort(),
      ).toEqual(['default', 'default-environment-1']);
      expect(refreshed.entriesCache.get('default')?.entries).toEqual({
        'node~test~ts': normalize(nodeFile),
      });
      expect(
        refreshed.entriesCache.get('default-environment-1')?.entries,
      ).toEqual({
        'jsdom~test~ts': normalize(jsdomFile),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves synthetic project discovery changes during refresh', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'node.test.ts');
      const jsdomFile = path.join(root, 'jsdom.test.ts');
      const newJsdomFile = path.join(root, 'new-jsdom.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');
      writeFileSync(newJsdomFile, '// @rstest-environment jsdom\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['node.test.ts', 'jsdom.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {},
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await planState.resolveRunnableProjects();
      const jsdomProject = context.projects.find(
        (item) => item.environmentName === 'default-environment-1',
      )!;
      jsdomProject.normalizedConfig.include = [
        'jsdom.test.ts',
        'new-jsdom.test.ts',
      ];

      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(
        refreshed.entriesCache.get('default-environment-1')?.entries,
      ).toEqual({
        'jsdom~test~ts': normalize(jsdomFile),
        'new-jsdom~test~ts': normalize(newJsdomFile),
      });
      expect(refreshed.entriesCache.get('default')?.entries).toEqual({
        'node~test~ts': normalize(nodeFile),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves claimed global setup when refresh recreates the base partition', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'node.test.ts');
      const jsdomFile = path.join(root, 'jsdom.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['jsdom.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {},
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: true,
      });

      await planState.resolveRunnableProjects();
      context.projects[0]!._globalSetups = true;
      context.projects[0]!.normalizedConfig.include = [
        'node.test.ts',
        'jsdom.test.ts',
      ];

      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(
        refreshed.projects
          .map((item) => ({
            environmentName: item.environmentName,
            globalSetupsClaimed: item._globalSetups,
          }))
          .sort((a, b) => a.environmentName.localeCompare(b.environmentName)),
      ).toEqual([
        {
          environmentName: 'default',
          globalSetupsClaimed: true,
        },
        {
          environmentName: 'default-environment-1',
          globalSetupsClaimed: true,
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves a modified base environment for option-only partitions', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const file = path.join(root, 'options.test.ts');
      writeFileSync(
        file,
        '// @rstest-environment-options { "url": "https://example.test/" }\n',
      );

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['*.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {},
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await planState.resolveRunnableProjects();
      context.projects[0]!.normalizedConfig.testEnvironment = {
        name: 'happy-dom',
      };

      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(refreshed.projects).toHaveLength(1);
      expect(refreshed.projects[0]!.normalizedConfig.testEnvironment).toEqual({
        name: 'happy-dom',
        options: {
          url: 'https://example.test/',
        },
      });
      expect(
        refreshed.entriesCache.get('default-environment-1')?.entries,
      ).toEqual({
        'options~test~ts': normalize(file),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('moves implicit entries when the base environment changes during refresh', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const implicitNodeFile = path.join(root, 'implicit-node.test.ts');
      const explicitNodeFile = path.join(root, 'explicit-node.test.ts');
      const jsdomFile = path.join(root, 'jsdom.test.ts');
      writeFileSync(implicitNodeFile, '// implicit node test\n');
      writeFileSync(explicitNodeFile, '// @rstest-environment node\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['*.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {},
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await planState.resolveRunnableProjects();
      const baseProject = context.projects.find(
        (item) => item.environmentName === 'default',
      )!;
      baseProject.normalizedConfig.testEnvironment = { name: 'happy-dom' };

      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(
        refreshed.projects.map((item) => ({
          environmentName: item.environmentName,
          testEnvironment: item.normalizedConfig.testEnvironment,
        })),
      ).toEqual([
        {
          environmentName: 'default-environment-2',
          testEnvironment: { name: 'node' },
        },
        {
          environmentName: 'default',
          testEnvironment: { name: 'happy-dom' },
        },
        {
          environmentName: 'default-environment-1',
          testEnvironment: { name: 'jsdom' },
        },
      ]);
      expect(refreshed.entriesCache.get('default')?.entries).toEqual({
        'implicit-node~test~ts': normalize(implicitNodeFile),
      });
      const allEntries = Object.assign(
        {},
        ...Array.from(refreshed.entriesCache.values()).map(
          (item) => item.entries,
        ),
      );

      expect(allEntries).toMatchObject({
        'explicit-node~test~ts': normalize(explicitNodeFile),
        'jsdom~test~ts': normalize(jsdomFile),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('recomputes global setup owner when refresh removes the base partition', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'node.test.ts');
      const jsdomFile = path.join(root, 'jsdom.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['*.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {},
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await planState.resolveRunnableProjects();
      for (const item of context.projects) {
        item.normalizedConfig.include = ['jsdom.test.ts'];
      }

      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(refreshed.projects).toHaveLength(1);
      expect(refreshed.projects[0]).toMatchObject({
        environmentName: 'default-environment-1',
        _globalSetups: false,
      });
      expect(
        refreshed.entriesCache.get('default-environment-1')?.entries,
      ).toEqual({
        'jsdom~test~ts': normalize(jsdomFile),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('moves global setup owner to a sharded partition with entries', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'a.test.ts');
      const jsdomFile = path.join(root, 'b.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['*.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {
          shard: {
            index: 2,
            count: 2,
          },
        },
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await planState.resolveRunnableProjects();
      const refreshed = await planState.resolveRunnableProjects({
        strictEnvironmentComments: true,
      });

      expect(refreshed.entriesCache.get('default')?.entries).toEqual({});
      expect(
        refreshed.entriesCache.get('default-environment-1')?.entries,
      ).toEqual({
        'b~test~ts': normalize(jsdomFile),
      });
      expect(
        refreshed.projects.map((item) => ({
          environmentName: item.environmentName,
          globalSetupsClaimed: item._globalSetups,
        })),
      ).toEqual([
        {
          environmentName: 'default',
          globalSetupsClaimed: true,
        },
        {
          environmentName: 'default-environment-1',
          globalSetupsClaimed: false,
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refreshes sharded browser entries after list partition refresh', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const nodeFile = path.join(root, 'a.test.ts');
      const jsdomFile = path.join(root, 'b.test.ts');
      const browserFile = path.join(root, 'c.test.ts');
      const otherBrowserFile = path.join(root, 'd.test.ts');
      const newBrowserFile = path.join(root, '0.test.ts');
      writeFileSync(nodeFile, '// node test\n');
      writeFileSync(jsdomFile, '// @rstest-environment jsdom\n');
      writeFileSync(browserFile, '// browser test\n');
      writeFileSync(otherBrowserFile, '// other browser test\n');
      writeFileSync(newBrowserFile, '// new browser test\n');

      const nodeProject: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['a.test.ts', 'b.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const browserProject: ProjectContext = {
        ...createProject(),
        name: 'browser',
        environmentName: 'browser',
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          name: 'browser',
          root,
          include: ['c.test.ts', 'd.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
          browser: {
            enabled: true,
          },
        },
      };
      const context = {
        rootPath: root,
        projects: [browserProject, nodeProject],
        normalizedConfig: {
          shard: {
            index: 1,
            count: 2,
          },
        },
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createListProjectPlanState(context);

      await planState.refreshListEntries({ strictEnvironmentComments: false });
      expect(planState.getShardedBrowserEntries()?.get('browser')).toEqual({
        entries: {},
      });

      for (const item of context.projects) {
        if (item.normalizedConfig.browser.enabled) {
          item.normalizedConfig.include = [
            '0.test.ts',
            'c.test.ts',
            'd.test.ts',
          ];
        }
      }

      await planState.refreshListEntries({ strictEnvironmentComments: true });

      expect(planState.getShardedBrowserEntries()?.get('browser')).toEqual({
        entries: {
          '0~test~ts': normalize(newBrowserFile),
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('validates ignored environment comment errors on the final run plan', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-env-comment-'));
    try {
      const file = path.join(root, 'invalid.test.ts');
      writeFileSync(file, '// @rstest-environment custom\n');

      const project: ProjectContext = {
        ...createProject(),
        rootPath: root,
        normalizedConfig: {
          ...createProject().normalizedConfig,
          root,
          include: ['*.test.ts'],
          exclude: {
            patterns: [],
            override: false,
          },
          includeSource: [],
        },
      };
      const context = {
        rootPath: root,
        projects: [project],
        normalizedConfig: {},
        fileFilters: [],
      } as unknown as RstestContext;
      const planState = createRunProjectPlanState({
        context,
        browserProjects: [],
        isWatchMode: false,
      });

      await expect(planState.resolveRunnableProjects()).resolves.toBeTruthy();
      await expect(planState.validateEnvironmentComments()).rejects.toThrow(
        'Unsupported test environment "custom"',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
