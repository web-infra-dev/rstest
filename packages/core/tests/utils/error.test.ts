import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { createListTestsError } from '../../src/api/listTestsError';
import {
  formatStack,
  parseErrorStacktrace,
  printError,
  stackIgnores,
  toSerializedError,
} from '../../src/utils/error';
import { logger } from '../../src/utils/logger';

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

  it('keeps the cause chain in toSerializedError', () => {
    const root = new TypeError('fetch failed');
    const errors = [
      new Error('globalSetup failed', { cause: root }),
      new Error('teardown failed', { cause: root }),
    ].map(toSerializedError);

    expect(errors).toMatchObject([
      {
        message: 'globalSetup failed',
        cause: {
          name: 'TypeError',
          message: 'fetch failed',
          stack: root.stack,
        },
      },
      { message: 'teardown failed', cause: { message: 'fetch failed' } },
    ]);
    expect(errors[0]!.cause).not.toHaveProperty('cause');
    expect(
      toSerializedError(new Error('failed', { cause: 'timeout' })),
    ).not.toHaveProperty('cause');
  });

  it('only keeps a string stack in toSerializedError', () => {
    const error = toSerializedError(
      new Error('wrapper', {
        cause: { message: 'API failed', stack: ['remote frame'] },
      }),
    );

    expect(error.cause!.message).toBe('API failed');
    expect(error.cause!.stack).toBeUndefined();
  });

  it('keeps printing the cause chain after the vitest import hint', async () => {
    const stderr = rs
      .spyOn(logger, 'stderr')
      .mockImplementation(() => undefined);
    onTestFinished(() => {
      stderr.mockRestore();
    });

    await printError(
      {
        message: 'Failed to run the test',
        cause: {
          message: 'Vitest failed to access its internal state',
          cause: { name: 'TypeError', message: 'innermost failure' },
        },
      },
      async () => null,
      '/project',
    );

    const output = stripVTControlCharacters(
      stderr.mock.calls.map(([message]) => message).join('\n'),
    );
    expect(output).toContain('Unknown Error: Failed to run the test');
    expect(output).toContain(
      'Caused by: Error: not support import `vitest` in Rstest test environment.',
    );
    expect(output).toContain('Caused by: TypeError: innermost failure');
  });

  it('stops toSerializedError at a circular cause chain', () => {
    const first = new Error('first');
    const second = new Error('second', { cause: first });
    first.cause = second;
    const self = new Error('self');
    self.cause = self;

    const error = toSerializedError(first);

    expect(error.cause).toMatchObject({ message: 'second' });
    expect(error.cause).not.toHaveProperty('cause');
    expect(toSerializedError(self)).not.toHaveProperty('cause');
  });

  it('source-maps the cause of a list error', async () => {
    const error = await createListTestsError({
      list: [],
      errors: [
        {
          name: 'Error',
          message: 'wrapper',
          stack: 'Error: wrapper\n    at load (/project/generated.js:1:1)',
          cause: {
            name: 'TypeError',
            message: 'root',
            stack:
              'TypeError: root\n    at connect (/project/generated.js:1:1)',
          },
        },
      ],
      showProject: false,
      getSourceMap: async () =>
        JSON.stringify({
          version: 3,
          names: [],
          sources: ['/project/src/source.ts'],
          mappings: 'AAAAA',
        }),
      close: async () => {},
    });

    const [wrapper] = error.unhandledErrors;
    expect(wrapper!.stack).toContain('source.ts:1:');
    expect(wrapper!.cause!.stack).toContain('TypeError: root');
    expect(wrapper!.cause!.stack).toContain('source.ts:1:');
    expect(wrapper!.cause!.stack).not.toContain('generated.js');
  });
});
