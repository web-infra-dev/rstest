import { stripVTControlCharacters } from 'node:util';
import { compileFunction } from 'node:vm';
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

  it.each(
    ['webpack', 'rspack'].flatMap((bundler) =>
      ['runtime/require', 'bootstrap', 'startup'].flatMap((source) => [
        `./${bundler}/${source}`,
        `${bundler}:///${bundler}/${source}`,
        `C:\\project\\${bundler}\\${source.replaceAll('/', '\\')}`,
      ]),
    ),
  )('filters source-mapped bundler frames from %s', async (source) => {
    const options = {
      stack: [
        'Error: Missing config file',
        '    at readConfig (/project/src/config.ts:2:9)',
        '    at requireModule (/project/dist/bundle.js:1:1)',
      ].join('\n'),
      getSourcemap: async (file: string) =>
        file === '/project/dist/bundle.js'
          ? {
              version: 3 as const,
              names: [],
              sources: [source],
              mappings: 'AAAA',
            }
          : null,
    };

    const frames = await parseErrorStacktrace({ ...options, fullStack: false });
    expect(frames.map((frame) => frame.file)).toEqual([
      '/project/src/config.ts',
    ]);

    const fullFrames = await parseErrorStacktrace({
      ...options,
      fullStack: true,
    });
    expect(fullFrames).toHaveLength(2);
    expect(fullFrames[0]).toEqual(frames[0]);
    expect(fullFrames[1]?.methodName).toBe('requireModule');
  });

  it('keeps user files named after bundler sources', async () => {
    const files = [
      '/project/src/webpack/bootstrap.ts',
      '/project/src/rspack/startup.ts',
      '/project/src/webpack/bootstrap-helper.ts',
      '/project/src/rspack/startup-config.ts',
    ];
    const frames = await parseErrorStacktrace({
      stack: files.map((file) => `    at load (${file}:1:1)`).join('\n'),
      fullStack: false,
    });
    expect(frames.map((frame) => frame.file)).toEqual(files);
  });

  it('drops rstest runtime frames whose path is URL-encoded', async () => {
    const frames = await parseErrorStacktrace({
      stack: [
        'Error: Missing config file',
        '    at readConfig (/project/src/config.ts:2:9)',
        '    at Object.apply (/project/dist/.rstest-temp/rstest%20runtime:26:1)',
        '    at /project/src/index.test.ts:4:5',
      ].join('\n'),
    });

    expect(frames.map((frame) => frame.file)).toEqual([
      '/project/src/config.ts',
      '/project/src/index.test.ts',
    ]);
  });

  it('source-maps a module frame in a bundle with a Windows path', async () => {
    const [frame] = await parseErrorStacktrace({
      stack: [
        'Error: Missing config file',
        '    at Object../src/server.ts (D:/project/dist/index.mjs:1:1)',
      ].join('\n'),
      getSourcemap: async (file) =>
        file === 'D:/project/dist/index.mjs'
          ? {
              version: 3,
              names: [],
              sources: ['/project/src/server.ts'],
              mappings: 'AAAA',
            }
          : null,
    });

    expect(frame).toMatchObject({
      methodName: 'Object../src/server.ts',
      file: '/project/src/server.ts',
    });
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

  it('only keeps a string name in toSerializedError', () => {
    const error = toSerializedError({
      message: 'wrapper',
      name: 42,
      cause: { message: 'root', name: { code: 'E_ROOT' } },
    });

    expect(error.message).toBe('wrapper');
    expect(error.name).toBeUndefined();
    expect(error.cause!.message).toBe('root');
    expect(error.cause!.name).toBeUndefined();
  });

  it('keeps the error in toSerializedError when reading its cause throws', () => {
    const cause = {
      get message(): string {
        throw new Error('metadata unavailable');
      },
    };

    const error = toSerializedError(new Error('operation failed', { cause }));

    expect(error.message).toBe('operation failed');
    expect(error).not.toHaveProperty('cause');
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

  it('does not read the error message as a frame', async () => {
    const locations = async (stack: string[]) =>
      (await parseErrorStacktrace({ stack: stack.join('\n') })).map(
        (frame) => `${frame.file}:${frame.lineNumber}`,
      );

    expect(
      await locations([
        'Error: connect ECONNREFUSED 127.0.0.1:5432',
        '    at connect (/project/src/db.ts:4:9)',
        '    at /project/src/db.test.ts:8:3',
      ]),
    ).toEqual(['/project/src/db.ts:4', '/project/src/db.test.ts:8']);
    expect(
      await locations([
        'Error: 2 services are down',
        '  api http://localhost:3000',
        '  db 127.0.0.1:5432',
        '    at checkServices (/project/src/health.ts:12:11)',
      ]),
    ).toEqual(['/project/src/health.ts:12']);
  });

  it.each([
    {
      position: 'an unexpected token',
      code: 'module.exports = {\n  port: 3000\n  host: 1\n};\n',
      line: 3,
    },
    {
      position: 'the end of the input',
      code: 'module.exports = {\n  port: 3000,\n',
      line: 3,
    },
    {
      position: 'the end of a file without a final newline',
      code: 'module.exports = {\n  port: 3000,',
      line: 2,
    },
    {
      position: 'an unclosed comment',
      code: 'module.exports = {};\n/* port: 3000\n',
      line: 2,
    },
  ])(
    'keeps the location Node puts in front of a SyntaxError at $position',
    async ({ code, line }) => {
      let error: unknown;
      try {
        compileFunction(code, [], { filename: '/project/src/config.cjs' });
      } catch (err) {
        error = err;
      }

      const [frame] = await parseErrorStacktrace({
        stack: toSerializedError(error).stack!,
      });

      expect(`${frame?.file}:${frame?.lineNumber}`).toBe(
        `/project/src/config.cjs:${line}`,
      );
    },
  );

  it('reads every line of a stack without `at` frames', async () => {
    const frames = await parseErrorStacktrace({
      stack: [
        'connect@http://localhost:63315/src/db.ts:4:9',
        '@http://localhost:63315/src/db.test.ts:8:3',
      ].join('\n'),
      fullStack: true,
    });

    expect(frames.map((frame) => `${frame.file}:${frame.lineNumber}`)).toEqual([
      'http://localhost:63315/src/db.ts:4',
      'http://localhost:63315/src/db.test.ts:8',
    ]);
  });
});
