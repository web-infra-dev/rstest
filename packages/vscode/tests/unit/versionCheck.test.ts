import { expect, it } from '@rstest/core';
import {
  formatUnsupportedCoreVersionMessage,
  isSupportedCoreVersion,
} from '../../src/versionCheck';

it.each([
  ['0.12.0', true],
  ['0.12.9', true],
  ['0.12.3-canary.1', true],
  ['0.12.0foo', false],
  ['0.11.9', false],
  ['0.13.0', false],
  ['1.0.0', false],
  [undefined, false],
  ['garbage', false],
] as const)('checks core version %s', (version, supported) => {
  expect(isSupportedCoreVersion(version)).toBe(supported);
});

it('explains the final release range and detected version', () => {
  const message = formatUnsupportedCoreVersionMessage('0.13.0');
  expect(message).toContain('^0.12.0');
  expect(message).toContain('found 0.13.0');
});
