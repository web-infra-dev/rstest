import { expect, it, rs } from '@rstest/core';

it('loads a manual __mocks__ module through importMock', async () => {
  const mocked = await rs.importMock<{
    default: (url: string) => string;
  }>('is-url');

  expect(mocked.default('https://example.com')).toBe('is-url manual mock');
});

it('uses a registered factory for importMock', async () => {
  rs.doMock('../src/increment', () => ({
    increment: (value: number) => value + 10,
  }));

  const request = '../src/increment';
  const mocked =
    await rs.importMock<typeof import('../src/increment')>(request);

  expect(mocked.increment(1)).toBe(11);
});

it('resolves a variable importMock request in browser mode', async () => {
  rs.mock('../src/sum', { mock: true });
  const request = '../src/sum';
  const mocked = await rs.importMock<typeof import('../src/sum')>(request);

  expect(rs.isMockFunction(mocked.foo)).toBe(true);
  expect(mocked.foo()).toBeUndefined();
  expect(mocked.sum).toBe(3);
});
