import fs from 'node:fs';
import { join } from 'node:path';
import { expect, it } from '@rstest/core';

declare module '@rstest/core' {
  interface Assertion<T = any> {
    toMatchImageSnapshot(): void;
  }
}

it('test toMatchImageSnapshot correctly', async () => {
  const { toMatchImageSnapshot } = await import('jest-image-snapshot');

  expect.extend({ toMatchImageSnapshot });
  const testFilePath = join(__dirname, '../assets/icon.png');

  // TODO: fixed by external jest-image-snapshot or get __dirname correctly in jest-image-snapshot
  expect(fs.readFileSync(testFilePath)).toMatchImageSnapshot();
});
