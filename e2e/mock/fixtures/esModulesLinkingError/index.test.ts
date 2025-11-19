import { describe, expect, it, rs } from '@rstest/core';
// @ts-expect-error
import * as serviceAPI from './services';

rs.mock('./services', () => ({
  value: 42,
}));

describe('Mock Module EsModulesLinkingError', () => {
  it('should return the mocked value', async () => {
    expect(serviceAPI.value).toBe(42);
  });
});
