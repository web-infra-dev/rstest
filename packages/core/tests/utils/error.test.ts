import { describe, expect, it } from '@rstest/core';
import {
  formatStack,
  parseErrorStacktrace,
  stackIgnores,
} from '../../src/utils/error';

describe('error helpers', () => {
  it('uses the mapped method name', async () => {
    const [frame] = await parseErrorStacktrace({
      stack:
        'Error: failed\n    at generatedMethod (/project/generated.js:1:1)',
      fullStack: true,
      getSourcemap: async () => ({
        version: 3,
        names: ['mappedMethod'],
        sources: ['source.ts'],
        mappings: 'AAAAA',
      }),
    });

    expect(frame?.methodName).toBe('mappedMethod');
    expect(formatStack(frame!, '/project')).toContain('mappedMethod');
    expect(formatStack(frame!, '/project')).not.toContain('generatedMethod');
  });

  it('applies a custom ignore list to source-mapped frames', async () => {
    const sourcemap = (source: string) => async () => ({
      version: 3 as const,
      names: [],
      sources: [source],
      mappings: 'AAAAA',
    });
    const stack = 'Error: boom\n    at run (/project/virtual.js:1:1)';
    const ignore = [...stackIgnores, /\/node_modules\//];

    const mappedToIgnored = await parseErrorStacktrace({
      stack,
      getSourcemap: sourcemap('/project/node_modules/@vitest/expect/index.js'),
      ignore,
    });
    const mappedToUserCode = await parseErrorStacktrace({
      stack,
      getSourcemap: sourcemap('/project/src/example.test.ts'),
      ignore,
    });

    expect(mappedToIgnored).toEqual([]);
    expect(mappedToUserCode.map((frame) => frame.file)).toEqual([
      '/project/src/example.test.ts',
    ]);
  });
});
