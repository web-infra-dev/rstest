import { resolve } from 'node:path';
import { it } from '@rstest/core';

it('throws with bundler runtime frames', () => {
  const error = new Error('Missing config file');
  // Model the virtual frames emitted by newer Rspack versions independently
  // of the compiler version installed in this workspace.
  error.stack = [
    'Error: Missing config file',
    `    at readConfig (${resolve('fixtures/agent-md/importError/config.ts')}:2:9)`,
    ...['webpack', 'rspack'].flatMap((bundler) =>
      ['runtime/require', 'bootstrap', 'startup'].map(
        (source) =>
          `    at requireModule (${resolve('dist/.rstest-temp', bundler, source)}:17:1)`,
      ),
    ),
  ].join('\n');
  throw error;
});
