import { describe, expect, it } from '@rstest/core';
import { RunnerSessionRegistry } from '../src/sessionRegistry';

describe('runner session registry', () => {
  it('should register and query by test file', () => {
    const registry = new RunnerSessionRegistry();

    const session = registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      browserName: 'chromium',
      runToken: 1,
      mode: 'headless-page',
    });

    expect(registry.getById(session.id)?.testFile).toBe('/tests/a.test.ts');
    expect(
      registry.getByTestFile('/tests/a.test.ts', {
        projectName: 'project',
        browserName: 'chromium',
      })?.id,
    ).toBe(session.id);
  });

  it('should replace mapping when re-registering same (project, browser) row', () => {
    const registry = new RunnerSessionRegistry();
    const first = registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      browserName: 'chromium',
      runToken: 1,
      mode: 'headless-page',
    });

    const second = registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      browserName: 'chromium',
      runToken: 2,
      mode: 'headless-page',
    });

    expect(
      registry.getByTestFile('/tests/a.test.ts', {
        projectName: 'project',
        browserName: 'chromium',
      })?.id,
    ).toBe(second.id);
    expect(registry.getById(first.id)).toBeDefined();
  });

  it('should index per browser: parallel rows of one file stay distinct', () => {
    const registry = new RunnerSessionRegistry();
    const chromium = registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      browserName: 'chromium',
      runToken: 1,
      mode: 'headless-page',
    });
    const firefox = registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      browserName: 'firefox',
      runToken: 1,
      mode: 'headless-page',
    });

    expect(chromium.id).not.toBe(firefox.id);
    expect(
      registry.getByTestFile('/tests/a.test.ts', {
        projectName: 'project',
        browserName: 'chromium',
      })?.id,
    ).toBe(chromium.id);
    expect(
      registry.getByTestFile('/tests/a.test.ts', {
        projectName: 'project',
        browserName: 'firefox',
      })?.id,
    ).toBe(firefox.id);
    // A bare path is ambiguous under multi-browser runs, so it matches nothing.
    expect(registry.getByTestFile('/tests/a.test.ts')).toBeUndefined();
  });

  it('should filter by run token', () => {
    const registry = new RunnerSessionRegistry();
    registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      runToken: 1,
      mode: 'headless-page',
    });
    registry.register({
      testFile: '/tests/b.test.ts',
      projectName: 'project',
      runToken: 2,
      mode: 'headless-page',
    });

    expect(registry.listByRunToken(1)).toHaveLength(1);
    expect(registry.listByRunToken(2)).toHaveLength(1);
  });
});
