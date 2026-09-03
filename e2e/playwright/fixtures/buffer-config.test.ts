import { Buffer } from 'node:buffer';
import { expect, test } from '@rstest/playwright';

test('rehydrates client certificate buffers', ({ playwright }) => {
  const certificate = playwright.contextOptions?.clientCertificates?.[0];

  expect(Buffer.isBuffer(certificate?.cert)).toBe(true);
  expect(certificate?.cert?.toString()).toBe('certificate');
  expect(Buffer.isBuffer(certificate?.key)).toBe(true);
  expect(certificate?.key?.toString()).toBe('key');
  console.log('RSTEST_PLAYWRIGHT_BUFFER_CONFIG_OK');
});
