import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { createRunPlanner } from '../../src/core/planner';
import { prepareRsbuild } from '../../src/core/rsbuild';
import { Rstest } from '../../src/core/rstest';

process.env.DEBUG = 'false';

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
) =>
  new Rstest(
    {
      cwd: root,
      command: 'run',
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

describe('createRunPlanner cold-start gate', () => {
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
    const planner = await createRunPlanner(context, {
      browserProjects: context.projects,
      nodeProjects: [],
      isWatchMode: false,
    });

    expect(prepareRsbuildSpy).not.toHaveBeenCalled();
    // No node build means the orchestrator constructs no node executor either,
    // which is the whole cost the gate exists to avoid.
    expect(planner.nodeBuild).toBeUndefined();
    expect(planner.hasNodeTestsToRun()).toBe(false);
    expect(planner.hasBrowserTestsToRun()).toBe(true);
  });

  it('boots one for a run that has node projects', async () => {
    const context = createContext(tempRoot, [{ name: 'node-a' }]);
    const planner = await createRunPlanner(context, {
      browserProjects: [],
      nodeProjects: context.projects,
      isWatchMode: false,
    });

    expect(prepareRsbuildSpy).toHaveBeenCalledTimes(1);
    expect(planner.nodeBuild).toBeDefined();
    expect(planner.hasNodeTestsToRun()).toBe(true);
  });
});
