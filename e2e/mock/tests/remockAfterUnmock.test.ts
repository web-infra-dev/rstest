import { afterEach, expect, it, rs } from '@rstest/core';

afterEach(() => {
  rs.doUnmock('../src/increment');
  rs.resetModules();
});

it('reevaluates the original module after unmocking a lazy auto-mock', async () => {
  rs.doMock('../src/increment', { mock: true });
  const mocked = await import('../src/increment');
  expect(mocked.increment(1)).toBeUndefined();

  rs.doUnmock('../src/increment');
  rs.resetModules();
  const original = await import('../src/increment');
  expect(original.increment(1)).toBe(2);

  rs.doMock('../src/increment', { mock: true });
  const remocked = await import('../src/increment');
  expect(remocked.increment(1)).toBeUndefined();
});
