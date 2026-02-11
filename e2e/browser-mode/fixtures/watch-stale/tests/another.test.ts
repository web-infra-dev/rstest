import { describe, expect, it } from '@rstest/core';
import { getMessage } from '../src/helper';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('watch stale companion', () => {
  it('should also assert helper value after delay', async () => {
    await sleep(1500);
    expect(getMessage()).toBe('hello');
  });
});
