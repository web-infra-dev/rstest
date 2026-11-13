import { afterEach, describe, it } from '@rstest/core';

it('passes before', () => {});

it('rejects without a reason', async () => {
  await Promise.reject();
});

it('throws null', () => {
  throw null;
});

it('throws a number', () => {
  throw 404;
});

it('throws a plain object', () => {
  throw { code: 'E_FAIL' };
});

describe('hook', () => {
  afterEach(() => {
    throw undefined;
  });

  it('fails in afterEach', () => {});
});

it('passes after', () => {});
