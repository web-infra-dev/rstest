import { beforeAll, describe, expect, it } from '@rstest/core';

beforeAll(() => {
  console.log('[rstest] Running basic tests');
});
describe('globalSetup tests', () => {
  it('should have global setup executed', () => {
    expect(process.env.GLOBAL_SETUP_EXECUTED).toBe('true');
    expect(process.env.GLOBAL_SETUP_MESSAGE).toBe('Global setup completed');
  });

  it('should access process.env', () => {
    expect(process.env.GLOBAL_SETUP_EXECUTED).toBe('true');
  });

  it('should not be able to access global variable', () => {
    // @ts-expect-error
    expect(global.SETUP).toBeUndefined();
  });
});
