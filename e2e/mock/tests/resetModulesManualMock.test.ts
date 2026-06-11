import { expect, it, rs } from '@rstest/core';
import redux from 'redux';

// `rs.mock('redux')` with no factory resolves to the manual mock in
// `e2e/__mocks__/redux.ts` (the string/number "module id" mock path).
// Regression: that mock must survive `rs.resetModules()` — which clears the
// module cache — instead of falling back to the real module on a later import.
rs.mock('redux');

it('manual mock survives rs.resetModules()', async () => {
  // @ts-expect-error: redux is mocked to a plain object.
  expect(redux.mocked).toBe('redux_yes');

  rs.resetModules();

  const reloaded = (await import('redux')).default as unknown as {
    mocked?: string;
  };
  expect(reloaded?.mocked).toBe('redux_yes');
});
