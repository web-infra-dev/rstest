import { describe, expect, it } from '@rstest/core';
import { RunnerSessionRegistry } from '../src/sessionRegistry';

describe('runner session registry', () => {
  it('registers sessions with identity records', () => {
    const registry = new RunnerSessionRegistry();

    const session = registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      browserName: 'chromium',
      runToken: 1,
      mode: 'headless-page',
    });

    expect(registry.getById(session.id)?.testFile).toBe('/tests/a.test.ts');
    expect(registry.getById(session.id)?.browserName).toBe('chromium');
  });

  it('keeps parallel rows of one file as distinct sessions', () => {
    // (project, browser) copies share a path, so identity stays on the
    // session record; the registry only keys by id and run token.
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
    expect(registry.getById(chromium.id)?.browserName).toBe('chromium');
    expect(registry.getById(firefox.id)?.browserName).toBe('firefox');
  });

  it('deletes by id and filters by run token', () => {
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
    expect(registry.deleteById('runner-session-1')).toBe(true);
    expect(registry.getById('runner-session-1')).toBeUndefined();
    expect(registry.deleteById('runner-session-1')).toBe(false);
  });

  it('clears every session', () => {
    const registry = new RunnerSessionRegistry();
    registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      runToken: 1,
      mode: 'headless-page',
    });
    expect(registry.list()).toHaveLength(1);
    registry.clear();
    expect(registry.list()).toEqual([]);
  });
});
