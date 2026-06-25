import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runBrowserCliWithCwd } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('browser mode - env', () => {
  it('should inject env into browser runtime without process shim', async () => {
    const { expectExecSuccess } = await runBrowserCliWithCwd(
      join(__dirname, 'fixtures', 'env'),
    );

    await expectExecSuccess();
  });
});
