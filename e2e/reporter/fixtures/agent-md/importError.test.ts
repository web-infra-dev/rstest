import { expect, it } from '@rstest/core';
import { port } from './importError/server';

it('reads the port', () => {
  expect(port).toBe(3000);
});
