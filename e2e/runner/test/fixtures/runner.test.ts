import { expect, it } from '@rstest/core';
import 'rstest-import';

it('should run setup correctly', async () => {
  expect(process.env.A).toBe('A');
});
