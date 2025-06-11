import { expect, it, rs } from '@rstest/core';
import { fs, vol } from 'memfs';
import { readSomeFile } from '../src/read-some-file';

rs.mock('node:fs');

it('should return correct text', () => {
  const path = '/hello-world.txt';
  fs.writeFileSync(path, 'hello world');

  const text = readSomeFile(path);
  expect(text).toBe('hello world');
});
