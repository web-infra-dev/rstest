import { runInNewContext } from 'node:vm';
import { expect, it } from '@rstest/core';
import { isError } from '../../src/utils/isError';

it('recognizes errors across realms without changing them', () => {
  for (const error of [
    new Error('local'),
    new DOMException('aborted', 'AbortError'),
    runInNewContext('new Error("foreign")'),
    runInNewContext('new (class CustomError extends Error {})("custom")'),
    runInNewContext('try { null.value } catch (error) { error }'),
  ]) {
    expect(isError(error)).toBe(true);
  }
});

it('does not treat arbitrary thrown values as errors', () => {
  for (const value of [
    null,
    undefined,
    false,
    1,
    'error',
    {},
    { message: 'error' },
  ]) {
    expect(isError(value)).toBe(false);
  }
});
