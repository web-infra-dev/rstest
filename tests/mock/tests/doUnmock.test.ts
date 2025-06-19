import { afterEach, beforeAll, expect, rs, test } from '@rstest/core';
import { isAction } from 'redux';

beforeAll(() => {
  rs.doMock('redux', () => ({
    isAction: {
      state: 1,
    },
  }));
});

// afterEach(() => {
//   rs.doUnmock('/data');
// });

test('first import', async () => {
  const redux = await import('redux');
  // @ts-ignore
  // @ts-ignore
  isAction.state = 2;
  // @ts-ignore
  expect(isAction.state).toBe(2);
});

test('second import should have been re-mocked', async () => {
  rs.doUnmock('redux');
  const redux = await import('redux');
  expect(typeof redux.isAction).toBe('function');
});

// test('unmock should clear modules replaced with imitation', async () => {
//   rs.doMock('../src/mockedDependency');
//   // const { helloWorld } = await import('../src/mockedDependency');
//   // expect(rs.isMockFunction(helloWorld)).toBe(true);

//   // rs.doUnmock('../src/mockedDependency');
//   // const { helloWorld: unmocked } = await import('../src/mockedDependency');
//   // expect(rs.isMockFunction(unmocked)).toBe(false);
// });
