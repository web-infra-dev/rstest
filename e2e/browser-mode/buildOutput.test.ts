import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from '@rstest/core';

const browserUiJsDir = join(
  __dirname,
  '../../packages/browser-ui/dist/container-static/js',
);
const embeddedBrowserUiJsDir = join(
  __dirname,
  '../../packages/browser/dist/browser-container/container-static/js',
);

it('should preserve pre-minified browser UI assets', () => {
  const sourceFiles = readdirSync(browserUiJsDir)
    .filter((file) => file.endsWith('.js'))
    .sort();
  const embeddedFiles = readdirSync(embeddedBrowserUiJsDir)
    .filter((file) => file.endsWith('.js'))
    .sort();

  expect(embeddedFiles).toEqual(sourceFiles);
  for (const file of sourceFiles) {
    expect(
      readFileSync(join(embeddedBrowserUiJsDir, file)).equals(
        readFileSync(join(browserUiJsDir, file)),
      ),
    ).toBe(true);
  }
});
