import { expect, it } from '@rstest/core';
// @ts-expect-error: plain .js module, no declaration file needed
import { fetchStrings } from './dynamic-import-origin/index.js';

it('should resolve template-literal dynamic imports against the source module', async () => {
  const strings = (await fetchStrings('en-us')) as { greeting: string };

  expect(strings.greeting).toBe('Hello');
});
