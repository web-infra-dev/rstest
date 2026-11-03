import { describe, expect, it } from '@rstest/core';
import { state } from '../../../../setup/fixtures/basic/sequence-state';
import { value } from '../../../../setup/fixtures/basic/sequence-target';

if (process.env.SETUP_FAILURE) console.log('TEST_COLLECTED_AFTER_FAILED_SETUP');
expect(state.firstFinished).toBe(true);
expect(state.secondFinished).toBe(true);

describe('setup files', () => {
  it('should have setup file executed', () => {
    expect(state.overlap).toBe(process.env.SETUP_SEQUENCE === 'parallel');
    expect(value).toBe('mocked');
    expect((globalThis as Record<string, unknown>).__SETUP_EXECUTED__).toBe(
      true,
    );
    expect(
      (globalThis as Record<string, unknown>).__SETUP_BEFORE_EACH_COUNT__,
    ).toBe(1);
  });

  it('should have setup timestamp', () => {
    const timestamp = (globalThis as Record<string, unknown>)
      .__SETUP_TIMESTAMP__ as number;
    expect(typeof timestamp).toBe('number');
    expect(timestamp).toBeLessThanOrEqual(Date.now());
    expect(
      (globalThis as Record<string, unknown>).__SETUP_BEFORE_EACH_COUNT__,
    ).toBe(2);
  });

  it('should have custom helper from setup', () => {
    const helper = (globalThis as Record<string, unknown>).__customHelper__ as (
      value: string,
    ) => string;
    expect(typeof helper).toBe('function');
    expect(helper('hello')).toBe('HELLO');
    expect(
      (globalThis as Record<string, unknown>).__SETUP_BEFORE_EACH_COUNT__,
    ).toBe(3);
  });
});
