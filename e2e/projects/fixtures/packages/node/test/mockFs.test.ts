import { afterAll, expect, it, rs } from '@rstest/core';
import { fs } from 'memfs';
import { readSomeFile } from '../src/readSomeFile';

rs.mock('node:fs');

afterAll(() => {
  rs.doUnmock('node:fs');
});

it('should return correct text', () => {
  const path = '/hello-world.txt';
  fs.writeFileSync(path, 'hello world');

  const text = readSomeFile(path);
  expect(text).toBe('hello world');
});
