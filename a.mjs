import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
console.log('😎', require.resolve('@rsbuild/core'));
