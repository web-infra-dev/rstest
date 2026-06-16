import { describe, expect, it, rs } from '@rstest/core';

rs.mock('@rsbuild/core', { mock: true });

describe('rs.mock with { mock: true } for large modules', () => {
  it('creates mocks lazily for nested exports', async () => {
    const rsbuild = await import('@rsbuild/core');

    expect(rs.isMockFunction(rsbuild.createRsbuild)).toBe(true);
    expect(rsbuild.createRsbuild()).toBeUndefined();
  });
});
