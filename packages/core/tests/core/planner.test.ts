import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { createTestPlanner } from '../../src/core/planner';
import { prepareRsbuild } from '../../src/core/rsbuild';
import { Rstest } from '../../src/core/rstest';

const originalDebug = process.env.DEBUG;
process.env.DEBUG = 'false';

afterAll(() => {
  if (originalDebug === undefined) {
    delete process.env.DEBUG;
  } else {
    process.env.DEBUG = originalDebug;
  }
});

// The cold-start gate is a planner condition now, not an orchestrator branch,
// so this is where it has to be pinned: the spy is the only thing that can tell
// "skipped the node build" apart from "built it and nobody used it". Defined
// inside the factory because `rs.mock` is hoisted above the imports.
rs.mock('../../src/core/rsbuild', () => ({
  prepareRsbuild: rs.fn(async () => ({
    initConfigs: rs.fn(async () => []),
  })),
}));

const prepareRsbuildSpy = rs.mocked(prepareRsbuild);

const createContext = (
  root: string,
  projects: Array<{ name: string; browser?: boolean }>,
  command: 'run' | 'watch' = 'run',
) =>
  new Rstest(
    {
      cwd: root,
      command,
      embedded: true,
      projects: projects.map(({ name, browser }) => ({
        config: {
          name,
          root,
          include: ['*.test.ts'],
          ...(browser
            ? { browser: { enabled: true, provider: 'playwright' as const } }
            : {}),
        },
      })),
    },
    { root },
  );

describe('createTestPlanner cold-start gate', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rstest-planner-'));
    writeFileSync(join(tempRoot, 'a.test.ts'), 'export {};\n');
    prepareRsbuildSpy.mockClear();
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('boots no node Rsbuild instance for a zero-node run', async () => {
    const context = createContext(tempRoot, [
      { name: 'browser-a', browser: true },
    ]);
    const planner = await createTestPlanner(context, {
      browserProjects: context.projects,
      nodeProjects: [],
      isWatchMode: false,
    });

    expect(prepareRsbuildSpy).not.toHaveBeenCalled();
    // No node build means the orchestrator constructs no node executor either,
    // which is the whole cost the gate exists to avoid.
    expect(planner.nodeBuild).toBeUndefined();
  });

  // The control for the test above: without it the gate assertion can rot into a
  // vacuous pass (the node build moved to a call site this spy no longer covers)
  // and nothing would notice — an extra or relocated boot is a cost, not a
  // behavior, so no e2e can see it either. Also pins "exactly one boot".
  it('boots one for a run that has node projects', async () => {
    const context = createContext(tempRoot, [{ name: 'node-a' }]);
    const planner = await createTestPlanner(context, {
      browserProjects: [],
      nodeProjects: context.projects,
      isWatchMode: false,
    });

    expect(prepareRsbuildSpy).toHaveBeenCalledTimes(1);
    expect(planner.nodeBuild).toBeDefined();
  });

  it('prepares watch environments hidden by the initial file filter', async () => {
    writeFileSync(
      join(tempRoot, 'dom.test.ts'),
      '// @rstest-environment jsdom\nexport {};\n',
    );
    const context = createContext(tempRoot, [{ name: 'node-a' }], 'watch');
    context.fileFilters = ['a.test.ts'];

    await createTestPlanner(context, {
      browserProjects: [],
      nodeProjects: context.projects,
      isWatchMode: true,
    });

    const targetProjects = prepareRsbuildSpy.mock.calls[0]![0]!.targetProjects;
    expect(targetProjects?.map((project) => project.environmentName)).toEqual([
      'node-a',
      'node-a-environment-1',
    ]);
    expect(targetProjects?.[0]).toBe(
      context.projects.find((project) => project.environmentName === 'node-a'),
    );
  });

  it('returns entries from projects revealed by a watch filter refresh', async () => {
    writeFileSync(
      join(tempRoot, 'dom.test.ts'),
      '// @rstest-environment jsdom\nexport {};\n',
    );
    const context = createContext(tempRoot, [{ name: 'node-a' }], 'watch');
    context.fileFilters = ['a.test.ts'];
    const planner = await createTestPlanner(context, {
      browserProjects: [],
      nodeProjects: context.projects,
      isWatchMode: true,
    });

    context.fileFilters = undefined;
    const entries = await planner.globTestEntries();

    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.endsWith('a.test.ts'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('dom.test.ts'))).toBe(true);
  });

  it('strictly validates environment comments revealed by a watch filter', async () => {
    writeFileSync(
      join(tempRoot, 'invalid.test.ts'),
      '// @rstest-environment custom\nexport {};\n',
    );
    const context = createContext(tempRoot, [{ name: 'node-a' }], 'watch');
    context.fileFilters = ['a.test.ts'];
    const planner = await createTestPlanner(context, {
      browserProjects: [],
      nodeProjects: context.projects,
      isWatchMode: true,
    });

    context.fileFilters = undefined;
    await expect(planner.globTestEntries()).rejects.toThrow(
      'Unsupported test environment "custom"',
    );
  });
});
