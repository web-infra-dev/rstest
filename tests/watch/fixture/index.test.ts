import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { sayHi } from './src/index';

const FIXTURE_DIR = path.resolve(__dirname, '../fixture');

afterAll(() => {
  console.log('afterAll');
});

describe('foo', () => {
  it('should test source code correctly', () => {
    expect(sayHi()).toBe('hi');
  });
});
