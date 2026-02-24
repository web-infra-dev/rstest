import { describe, expect, it } from '@rstest/core';
import { RunnerSessionRegistry } from '../src/sessionRegistry';

describe('runner session registry', () => {
  it('should register and query by test file', () => {
    const registry = new RunnerSessionRegistry();

    const session = registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      runToken: 1,
      mode: 'headless-page',
    });

    expect(registry.getById(session.id)?.testFile).toBe('/tests/a.test.ts');
    expect(registry.getByTestFile('/tests/a.test.ts')?.id).toBe(session.id);
  });

  it('should replace mapping when re-registering same test file', () => {
    const registry = new RunnerSessionRegistry();
    const first = registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      runToken: 1,
      mode: 'headless-page',
    });

    const second = registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      runToken: 2,
      mode: 'headless-page',
    });

    expect(registry.getByTestFile('/tests/a.test.ts')?.id).toBe(second.id);
    expect(registry.getById(first.id)).toBeDefined();
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
