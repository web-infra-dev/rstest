import { describe, expect, it } from '@rstest/core';
import pathe from 'pathe';
import { sayHi } from '../src/index';

describe('Index', () => {
  it('should add two numbers correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('should test source code correctly', () => {
    expect(sayHi()).toBe('hi');
  });

  it('should get RSTEST flag correctly', () => {
    expect(process.env.RSTEST).toBe('true');
  });

  it('should use node API correctly', async () => {
    expect(
      pathe
        .resolve(__dirname, '../src/index.ts')
        .endsWith('/basic/src/index.ts'),
    ).toBeTruthy();
  });

  it('should use require.resolve correctly', async () => {
    const resolved = require.resolve('../src/index.ts');
    expect(resolved.endsWith('index.ts')).toBeTruthy();
  });
});
