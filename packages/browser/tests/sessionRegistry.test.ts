import { describe, expect, it } from '@rstest/core';
import { RunnerSessionRegistry } from '../src/sessionRegistry';

describe('runner session registry', () => {
  it('registers sessions with identity records', () => {
    const registry = new RunnerSessionRegistry();

    const session = registry.register({
      testFile: '/tests/a.test.ts',
      projectName: 'project',
      runToken: 1,
      mode: 'headless-page',
    });

    expect(registry.getById(session.id)?.testFile).toBe('/tests/a.test.ts');
  });
});
