import { describe, expect, it, rs } from '@rstest/core';
import { join } from 'pathe';
import { createBrowserRunPlanner } from '../../src/core/browser/runPlanner';
import {
  isBrowserProject,
  isNodeProject,
} from '../../src/core/isBrowserProject';
import type { RunProjectPlan } from '../../src/core/projectPlan';
import { Rstest } from '../../src/core/rstest';

const rootPath = join(__dirname, '../..');

/**
 * The browser planner reads a plan and a way to re-resolve it — nothing else.
 * That is the whole seam `createRunPlanner` hands it, which is what lets this
 * exercise it without a plan state, an executor, or a browser boot behind it.
 */
const createPlanAccess = (
  browserProjectsToRun: RunProjectPlan['browserProjectsToRun'] = [],
) => {
  const plan: RunProjectPlan = {
    projects: [],
    entriesCache: new Map(),
    browserProjectsToRun,
    nodeProjectsToRun: [],
  };
  return {
    getPlan: () => plan,
    refreshPlan: rs.fn(async () => {}),
  };
};

/**
 * `browserHasConfigHook` decides whether the browser project carries a user
 * `modifyRstestConfig` plugin — the only thing the discovery boot exists for.
 */
const createProjects = (browserHasConfigHook: boolean) => {
  const context = new Rstest(
    {
      cwd: rootPath,
      command: 'run',
      projects: [
        { config: { root: join(rootPath, 'node-a'), name: 'node-a' } },
        {
          config: {
            root: join(rootPath, 'browser-a'),
            name: 'browser-a',
            browser: { enabled: true, provider: 'playwright' },
            plugins: browserHasConfigHook
              ? [{ name: 'user-config-plugin', setup: () => {} }]
              : undefined,
          },
        },
      ],
    },
    {},
  );
  return {
    context,
    browserProjects: context.projects.filter(isBrowserProject),
    nodeProjects: context.projects.filter(isNodeProject),
  };
};

describe('createBrowserRunPlanner', () => {
  it('hands the discovery boot and the real run the same applied-hook set', () => {
    const { context, browserProjects, nodeProjects } = createProjects(true);
    const planner = createBrowserRunPlanner({
      context,
      ...createPlanAccess(),
      browserProjects,
      nodeProjects,
    });

    const first = planner.getExecutorRunOptions(browserProjects);
    const second = planner.getExecutorRunOptions(browserProjects);

    // Browser `modifyRstestConfig` hooks must fire once across the discovery
    // boot and the run that follows it, and the set is how the host knows which
    // environments already applied theirs. Two option bags carrying two sets
    // would re-apply every hook in the real run.
    expect(first.appliedModifyRstestConfigEnvironments).toBe(
      second.appliedModifyRstestConfigEnvironments,
    );
  });

  it('declines the discovery boot when no browser project carries a config hook', async () => {
    const { context, browserProjects, nodeProjects } = createProjects(false);
    const planAccess = createPlanAccess();
    const planner = createBrowserRunPlanner({
      context,
      ...planAccess,
      browserProjects,
      nodeProjects,
    });

    // With nothing to discover the boot never happens, so the plan is not
    // re-resolved either — and with an empty browser subset in the plan, there
    // is no browser side to this run at all.
    await planner.runConfigHookDiscovery();

    expect(planAccess.refreshPlan).not.toHaveBeenCalled();
    expect(planner.hasBrowserTestsToRun()).toBe(false);
    expect(planner.getBrowserProjectsToRun()).toEqual([]);
  });

  it('falls back to the config-hook projects when the plan resolved no browser project', () => {
    const { context, browserProjects, nodeProjects } = createProjects(true);
    const planner = createBrowserRunPlanner({
      context,
      ...createPlanAccess(),
      browserProjects,
      nodeProjects,
    });

    // The plan cannot see test files a browser hook is about to add, so an empty
    // browser subset still runs the hook-carrying projects rather than nothing.
    expect(planner.hasBrowserTestsToRun()).toBe(true);
    expect(planner.getBrowserProjectsToRun()).toEqual(browserProjects);
  });

  it('prefers the plan over the fallback once it resolved a browser subset', () => {
    const { context, browserProjects, nodeProjects } = createProjects(true);
    const planned = [...browserProjects];
    const planner = createBrowserRunPlanner({
      context,
      ...createPlanAccess(planned),
      browserProjects,
      nodeProjects,
    });

    // Asserted by identity: a resolved subset is what runs, never the
    // hook-carrying fallback recomputed alongside it.
    expect(planner.getBrowserProjectsToRun()).toBe(planned);
  });
});
