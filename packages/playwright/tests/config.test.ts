import { Buffer } from 'node:buffer';
import { describe, expect, it } from '@rstest/core';
import { definePlaywrightConfig } from '../src/config';

describe('definePlaywrightConfig', () => {
  it('generates a setup file with serialized Playwright options', () => {
    const config = definePlaywrightConfig({
      contextOptions: {
        viewport: { width: 1440, height: 900 },
      },
    });
    const setupFile = Array.isArray(config.setupFiles)
      ? config.setupFiles[0]
      : config.setupFiles;

    expect(setupFile).toMatch(/^data:text\/javascript;base64,/);
    if (!setupFile) {
      throw new Error('Expected definePlaywrightConfig to add a setup file.');
    }
    const source = Buffer.from(
      setupFile.slice('data:text/javascript;base64,'.length),
      'base64',
    ).toString('utf8');
    expect(source).toContain(
      "import { __registerPlaywrightConfig } from '@rstest/playwright/config';",
    );
    expect(source).toContain(
      '__registerPlaywrightConfig({"contextOptions":{"viewport":{"width":1440,"height":900}}});',
    );
  });

  it('rejects values that cannot be serialized into the setup file', () => {
    expect(() =>
      definePlaywrightConfig({
        launchOptions: {
          logger: {
            isEnabled: () => true,
            log: () => {},
          },
        },
      }),
    ).toThrow('Playwright config only supports JSON-serializable values.');

    expect(() =>
      definePlaywrightConfig({
        requestOptions: {
          clientCertificates: [
            {
              origin: 'https://example.com',
              cert: Buffer.from('certificate'),
              key: Buffer.from('key'),
            },
          ],
        },
      }),
    ).toThrow('Playwright config only supports arrays and plain objects.');
  });
});
