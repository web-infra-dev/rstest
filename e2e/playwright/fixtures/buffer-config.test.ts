import { Buffer } from 'node:buffer';
import { rs } from '@rstest/core';
import { expect, test } from '@rstest/playwright';
import { request as playwrightRequest } from 'playwright';

const requestContextSpy = rs.spyOn(playwrightRequest, 'newContext');

test('rehydrates client certificate buffers', ({ playwright, request }) => {
  const certificate = playwright.contextOptions?.clientCertificates?.[0];

  expect(Buffer.isBuffer(certificate?.cert)).toBe(true);
  expect(certificate?.cert?.toString()).toBe('certificate');
  expect(Buffer.isBuffer(certificate?.key)).toBe(true);
  expect(certificate?.key?.toString()).toBe('key');
  expect(request).toBeTruthy();

  const requestCertificate =
    requestContextSpy.mock.calls.at(-1)?.[0]?.clientCertificates?.[0];
  expect(Buffer.isBuffer(requestCertificate?.cert)).toBe(true);
  expect(requestCertificate?.cert?.toString()).toBe('request-certificate');
  expect(Buffer.isBuffer(requestCertificate?.key)).toBe(true);
  expect(requestCertificate?.key?.toString()).toBe('key');
  console.log('RSTEST_PLAYWRIGHT_BUFFER_CONFIG_OK');
});
