import { join } from 'node:path';

export default {
  target: 'node',
  externals: {
    'strip-ansi': 'commonjs node:path',
  },
  resolve: {
    fallback: {
      'adapter-fallback': join(import.meta.dirname, 'fallback.ts'),
    },
    tsConfig: {
      configFile: join(import.meta.dirname, 'tsconfig.json'),
      references: [join(import.meta.dirname, 'tsconfig.paths.json')],
    },
  },
};
