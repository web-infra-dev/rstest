import { beforeAll, describe, expect, it } from '@rstest/core';

console.log('file level log');

describe('passing suite', () => {
  beforeAll(() => {
    console.log('passing suite log');
  });

  it('passing case', () => {
    console.log('passing case log');
    expect(1 + 1).toBe(2);
  });
});

describe('failing suite', () => {
  beforeAll(() => {
    console.log('failing suite log');
  });

  it('failing case', () => {
    console.log('failing case log');
    expect(1 + 1).toBe(3);
  });
});
