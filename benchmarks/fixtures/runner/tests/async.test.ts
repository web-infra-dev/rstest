import { describe, expect, it } from '@rstest/core';

describe('runtime async execution', () => {
  it('resolves a batch of values', async () => {
    const values = await Promise.all([
      Promise.resolve(1),
      Promise.resolve(3),
      Promise.resolve(5),
    ]);

    expect(values.reduce((sum, value) => sum + value, 0)).toBe(9);
  });

  it('awaits mapped async work deterministically', async () => {
    const values = await Promise.all(
      ['core', 'runner', 'rstest'].map(async (value, index) => {
        await Promise.resolve();
        return `${index}:${value.toUpperCase()}`;
      }),
    );

    expect(values).toEqual(['0:CORE', '1:RUNNER', '2:RSTEST']);
  });
});
