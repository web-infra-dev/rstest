import { describe, expect, it } from '@rstest/core';
import { rpcErrorCodec } from '../../src/shared/rpc';

const jsonRoundTrip = (message: object) =>
  rpcErrorCodec.deserialize(
    JSON.parse(JSON.stringify(rpcErrorCodec.serialize(message))),
  );

describe('rpcErrorCodec', () => {
  it('keeps a thrown Error across a JSON channel', () => {
    const error = new TypeError('unsupported core');
    const received = jsonRoundTrip({ t: 's', i: '1', e: error });

    expect(received.e).toBeInstanceOf(Error);
    expect((received.e as Error).name).toBe('TypeError');
    expect((received.e as Error).message).toBe('unsupported core');
    expect((received.e as Error).stack).toBe(error.stack);
  });

  it('passes messages without an error through unchanged', () => {
    const message = { t: 's', i: '1', r: { e: 1 } };
    expect(jsonRoundTrip(message)).toEqual(message);
  });
});
