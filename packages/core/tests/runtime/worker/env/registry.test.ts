import { describe, expect, it } from '@rstest/core';
import { environmentLoaders } from '../../../../src/runtime/worker/env/registry';

describe('test environment registry', () => {
  it('exposes loaders for exactly the non-node environments', () => {
    expect(Object.keys(environmentLoaders).sort()).toEqual([
      'happy-dom',
      'jsdom',
    ]);
    // `node` is the no-op fast path, never a loader entry.
    expect('node' in environmentLoaders).toBe(false);
  });

  it('each loader resolves to an adapter whose name matches its registry key', async () => {
    for (const key of Object.keys(environmentLoaders) as Array<
      keyof typeof environmentLoaders
    >) {
      const { environment } = await environmentLoaders[key]();
      expect(environment.name).toBe(key);
      expect(typeof environment.setup).toBe('function');
    }
  });
});
