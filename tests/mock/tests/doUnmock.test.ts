import { beforeAll, expect, rs, test } from '@rstest/core';
import { isAction } from 'redux';

beforeAll(() => {
  rs.doMock('redux', () => ({
    isAction: {
      state: 1,
    },
  }));
});

test('first import', async () => {
  const redux = await import('redux');

  // doMock is not hoisted.
  expect(typeof isAction).toBe('function');
  // @ts-expect-error
  expect(redux.isAction.state).toBe(1);
  // @ts-expect-error
  redux.isAction.state = 2;
  // @ts-expect-error
  expect(redux.isAction.state).toBe(2);
});

test('second import should have been re-mocked', async () => {
  rs.doUnmock('redux');
  const redux = await import('redux');
  expect(typeof redux.isAction).toBe('function');
});
