import { expect, it } from '@rstest/core';
// @ts-expect-error: plain .js module, no declaration file needed
import { fetchStrings } from './dynamic-import-origin/index.js';

it('should resolve template-literal dynamic imports against the source module', async () => {
  const strings = (await fetchStrings('en-us')) as { greeting: string };

  expect(strings.greeting).toBe('Hello');
});

it.each([undefined, { with: { type: 'json' } }])(
  'exposes JSON properties and default with options %j',
  async (options) => {
    const strings = await fetchStrings('en-us', options);
    expect(Object.keys(strings).sort()).toEqual(['default', 'greeting']);
    expect(strings.greeting).toBe('Hello');
    expect(strings.default.greeting).toBe('Hello');
    expect((await fetchStrings('en-us', options)).default).toBe(
      strings.default,
    );
  },
);

it('rejects an explicitly unsupported JSON import type', async () => {
  // Node 20 reports unsupported import attributes as ERR_IMPORT_ASSERTION_TYPE_UNSUPPORTED;
  // Node 21 renamed it to ERR_IMPORT_ATTRIBUTE_UNSUPPORTED.
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  await expect(
    fetchStrings('en-us', { with: { type: 'text' } }),
  ).rejects.toMatchObject({
    code:
      nodeMajor < 21
        ? 'ERR_IMPORT_ASSERTION_TYPE_UNSUPPORTED'
        : 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
  });
});
