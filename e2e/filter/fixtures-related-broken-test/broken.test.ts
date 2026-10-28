import { expect, it } from '@rstest/core';
import { cartCount } from './src/cart';

it('should use the cart count', () => {
  expect(cartCount).toBe(2);
});
