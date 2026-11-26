import { threadId } from 'node:worker_threads';
import { expect, it } from '@rstest/core';

it('uses the current project federation hooks and console', async () => {
  const name = process.env.RSTEST_E2E_MF_PROJECT;
  const enabled = name !== 'plain';
  const runtime = globalThis as typeof globalThis & {
    __rstest_federation__: boolean;
    __rstest_dynamic_import__?: (
      id: string,
    ) => Promise<typeof import('node:path')>;
  };
  expect(runtime.__rstest_federation__).toBe(enabled);
  expect(typeof runtime.__rstest_dynamic_import__).toBe(
    enabled ? 'function' : 'undefined',
  );
  if (runtime.__rstest_dynamic_import__) {
    const path = await runtime.__rstest_dynamic_import__('node:path');
    expect(path.basename('/a/b')).toBe('b');
  }
  const caution = 'build target is not set to "async-node"';
  console.warn(`[project:${name}]`, caution);
  // A warning on the underlying worker console must survive even inside an MF file.
  process
    .getBuiltinModule('node:console')
    .warn(`[worker:${process.pid}/${threadId}:${name}]`, caution);
});
