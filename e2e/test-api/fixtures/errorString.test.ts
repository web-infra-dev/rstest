import { it } from '@rstest/core';

it('test error string', () => {
  return new Promise((_resolve, reject) => {
    reject('aaaa');
  });
});
