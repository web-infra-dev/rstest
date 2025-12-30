import { expect, it } from '@rstest/core';

it('should print the url', () => {
  expect(window.location.href).toBe('http://localhost:8081/test-options');
});
