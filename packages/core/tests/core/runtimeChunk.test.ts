import { describe, expect, it } from '@rstest/core';
import {
  isRuntimeChunk,
  RUNTIME_CHUNK_BASE_NAME,
  runtimeChunkNameForEnvironment,
} from '../../src/core/runtimeChunk';

describe('runtime chunk grammar', () => {
  it('derives the per-environment runtime chunk name', () => {
    expect(RUNTIME_CHUNK_BASE_NAME).toBe('runtime');
    // Pins the exact strings the rsbuild snapshot asserts.
    expect(runtimeChunkNameForEnvironment('test')).toBe('test-runtime');
    expect(runtimeChunkNameForEnvironment('test-node')).toBe(
      'test-node-runtime',
    );
  });

  it('identifies the runtime chunk by id or names membership', () => {
    expect(
      isRuntimeChunk({ id: 'test-runtime', names: [] }, 'test-runtime'),
    ).toBe(true);
    expect(
      isRuntimeChunk({ id: 'x', names: ['a', 'test-runtime'] }, 'test-runtime'),
    ).toBe(true);
    expect(
      isRuntimeChunk({ id: 'main', names: ['main'] }, 'test-runtime'),
    ).toBe(false);
    expect(isRuntimeChunk({ id: 'main' }, 'test-runtime')).toBe(false);
  });
});
