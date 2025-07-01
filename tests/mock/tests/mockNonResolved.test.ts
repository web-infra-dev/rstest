import { afterEach, beforeEach, expect, rs, test } from '@rstest/core';

beforeEach(() => {
  rs.doMock('/data', () => ({
    data: {
      state: 'STARTED',
    },
  }));
});

afterEach(() => {
  rs.doUnmock('/data');
});

test('first import', async () => {
  // @ts-expect-error I know this
  const { data } = await import('/data');
  data.state = 'STOPPED';
  expect(data.state).toBe('STOPPED');
});

test('second import should have been re-mocked', async () => {
  // @ts-expect-error
  const { data } = await import('/data');
  expect(data.state).toBe('STARTED');
});
