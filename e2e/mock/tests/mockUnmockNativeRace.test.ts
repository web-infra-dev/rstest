import nodeModule from 'node:module';
import { describe, expect, it, rs } from '@rstest/core';

// #1485 (Codex P2): `rs.unmock()` defers the native-registry removal on a
// microtask (to preserve mock→unmock ordering). This checks the claimed race —
// that a non-literal `import()` of the just-unmocked module in the same turn
// could still see the stale native mock. The deferred unpublish is queued at
// `rs.unmock()` time, before the async `import()` resolution begins, so it runs
// before Node's registerHooks resolve hook; the real module must win.
const HAS_REGISTER_HOOKS =
  typeof (nodeModule as { registerHooks?: unknown }).registerHooks ===
  'function';

rs.mock('node:os', () => ({ hostname: () => 'MOCKED' }));

describe.skipIf(!HAS_REGISTER_HOOKS)('unmock then non-literal import', () => {
  it('sees the real module, not a stale native mock', async () => {
    rs.unmock('node:os');
    const spec = ['node', 'os'].join(':');
    const os = (await import(spec)) as unknown as { hostname: () => string };
    expect(os.hostname()).not.toBe('MOCKED');
  });
});
