import { afterEach, describe, expect, it, rs } from '@rstest/core';
import type { RstestContext } from '@rstest/core/internal/browser';
import { createBrowserExecutor } from '../src/browserExecutor';

describe('browser executor rerun requests', () => {
  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('reports a rerun it has no watch session to schedule on', async () => {
    // Core arms the rerun keys once every executor is past its first cycle —
    // settled, not necessarily succeeded — so a shortcut can reach a host whose
    // launch never opened a session. Resolving quietly there would let the key
    // report a rerun that never ran.
    const logs: string[] = [];
    rs.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    const executor = await createBrowserExecutor(
      { command: 'watch' } as unknown as RstestContext,
      { projects: [], coverageProvider: null },
    );

    await executor.requestRerun(['/a.test.ts']);

    expect(logs.join('\n')).toContain('no live watch session');
  });
});
