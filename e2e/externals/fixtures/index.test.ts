import { expect, it, rs } from '@rstest/core';
import stripAnsi from 'strip-ansi';

it('should load esm correctly', () => {
  expect(stripAnsi('\u001B[4mUnicorn\u001B[0m')).toBe('Unicorn');
});

it('should load esm dynamic correctly', async () => {
  const { default: stripAnsi } = await import('strip-ansi');
  expect(stripAnsi('\u001B[4mUnicorn\u001B[0m')).toBe('Unicorn');
});

it('should importMock a factory for both bundled and external dependencies', async () => {
  rs.doMock('strip-ansi', () => ({
    default: () => 'MOCKED_STRIP_ANSI',
  }));

  const request = 'strip-ansi';
  const mocked = await rs.importMock<typeof import('strip-ansi')>(request);

  expect(mocked.default('ignored')).toBe('MOCKED_STRIP_ANSI');
  rs.doUnmock('strip-ansi');
});

it('should load cjs with require correctly', () => {
  const picocolors = require('picocolors');
  expect(picocolors.green).toBeDefined();
});

it('should load pkg from some other pkgs correctly', async () => {
  const { pathe } = await import('./test-pkg/index');
  expect(pathe.basename('test-pkg/index.ts')).toBe('index.ts');
});
