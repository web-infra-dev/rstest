import { expect, rs, test } from '@rstest/core';
import { sleep } from '../../scripts/utils';

test('doMock works', async () => {
  rs.doMock('../src/increment', () => ({
    increment: (num: number) => num + 10,
  }));

  rs.requireActual('../src/increment');
});
