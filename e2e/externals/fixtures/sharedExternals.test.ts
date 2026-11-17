import { expect, it } from '@rstest/core';

declare const EXPECTED_ENVIRONMENT: 'node' | 'jsdom' | 'happy-dom';

it('preserves user external rules and the selected environment', () => {
  const { basename } = require('shared-user-external');
  expect(basename('/example/test.ts')).toBe('test.ts');
  expect(typeof window).toBe(
    EXPECTED_ENVIRONMENT === 'node' ? 'undefined' : 'object',
  );
});
