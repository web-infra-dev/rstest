import { afterAll, expect, it, rs } from '@rstest/core';
import redux from 'redux';

// `rs.mock(id)` with no factory applies the manual mock under `__mocks__/`.
// Regression: the manual mock must keep applying after `rs.resetModules()` —
// for both a bundled module and a dynamically imported external — instead of
// reverting to the real module on a later import.
rs.mock('redux');
rs.mock('node:dns');

afterAll(() => {
  rs.doUnmock('node:dns');
});

it('bundled manual mock survives rs.resetModules()', async () => {
  // @ts-expect-error: redux is mocked to a plain object.
  expect(redux.mocked).toBe('redux_yes');

  rs.resetModules();

  const reloaded = (await import('redux')).default as unknown as {
    mocked?: string;
  };
  expect(reloaded?.mocked).toBe('redux_yes');
});

it('dynamically imported external manual mock survives rs.resetModules()', async () => {
  const before = (await import('node:dns')).default as unknown as {
    __tag?: string;
  };
  expect(before?.__tag).toBe('MOCKED_DNS');

  rs.resetModules();

  const after = (await import('node:dns')).default as unknown as {
    __tag?: string;
  };
  expect(after?.__tag).toBe('MOCKED_DNS');
});
