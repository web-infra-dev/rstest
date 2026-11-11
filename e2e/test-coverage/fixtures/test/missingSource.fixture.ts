import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@rstest/core';

test('counts a minified external module without its original source', async () => {
  const url = pathToFileURL(
    join(import.meta.dirname, '../test-temp-merged/index.js'),
  );
  const module: Record<
    'inlinedValue' | 'inlinedUncovered',
    (log: (message: string) => void) => void
  > = await import(/* webpackIgnore: true */ url.href);
  const messages: string[] = [];
  module.inlinedValue((message) => messages.push(message));
  expect(module.inlinedUncovered).toBeTypeOf('function');
  expect(messages).toEqual(['returned']);
});
