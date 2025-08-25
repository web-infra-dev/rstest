import { afterEach, describe, expect, it, onTestFinished } from '@rstest/core';

afterEach(() => {
  console.log('[afterEach] root');
});

describe('level A', () => {
  it('it in level A', () => {
    expect(1 + 1).toBe(2);

    onTestFinished(() => {
      console.log('[onTestFinished] in level A');
    });
  });

  afterEach(() => {
    console.log('[afterEach] in level A');
  });
});

it('it in level B', () => {
  expect(1 + 1).toBe(2);
});
