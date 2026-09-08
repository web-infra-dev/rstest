import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCLI } from '@rstest/core/api';

const root = join(dirname(fileURLToPath(import.meta.url)), 'cli-missing-deps');
process.stdin.isTTY = true;
// The child uses a pipe, so emulate the TTY method used by the prompt.
process.stdin.setRawMode = () => process.stdin;
await runCLI({
  argv: [
    ...process.argv.slice(0, 2),
    'run',
    '--root',
    root,
    '--globals',
    '--coverage',
  ],
});
