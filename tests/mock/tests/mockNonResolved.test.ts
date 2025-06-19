import { afterEach, beforeAll, expect, rs, test } from '@rstest/core';

beforeAll(() => {
  rs.doMock('/data', () => ({
    data: {
      state: 'STARTED',
    },
  }));
});

// afterEach(() => {
//   rs.doUnmock('/data');
// });

test('first import', async () => {
  // @ts-expect-error I know this
  const { data } = await import('/data');
  data.state = 'STOPPED';
  expect(data.state).toBe('STOPPED');
});

// test('second import should have been re-mocked', async () => {
//   rs.doUnmock('/data');
//   // @ts-expect-error I know this
//   const { data } = await import('/data');
//   expect(data.state).toBe('STARTED');
// });

// test('unmock should clear modules replaced with imitation', async () => {
//   rs.doMock('../src/mockedDependency');
//   // const { helloWorld } = await import('../src/mockedDependency');
//   // expect(rs.isMockFunction(helloWorld)).toBe(true);

//   // rs.doUnmock('../src/mockedDependency');
//   // const { helloWorld: unmocked } = await import('../src/mockedDependency');
//   // expect(rs.isMockFunction(unmocked)).toBe(false);
// });
