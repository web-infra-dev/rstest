import { Buffer } from 'node:buffer';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['./buffer-config.test.ts'],
  pool: { type: 'threads' },
  testEnvironment: 'node',
  playwright: {
    contextOptions: {
      clientCertificates: [
        {
          origin: 'https://example.com',
          cert: Buffer.from('certificate'),
          key: Buffer.from('key'),
        },
      ],
    },
  },
});
