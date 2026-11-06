import { runInNewContext } from 'node:vm';
import { expect, it } from '@rstest/core';
import { serializeError } from '../../src/pool/protocol';

it('serializes foreign error details without losing its cause', () => {
  const error = runInNewContext(
    'new TypeError("foreign RPC error", { cause: new Error("cause") })',
  );
  expect(serializeError(error)).toEqual({
    name: 'TypeError',
    message: error.message,
    stack: error.stack,
    cause: error.cause,
  });
  expect(serializeError(error).cause).toBe(error.cause);
});
