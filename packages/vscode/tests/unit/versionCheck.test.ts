import { expect, it } from '@rstest/core';
import {
  formatUnsupportedCoreVersionMessage,
  isSupportedCoreVersion,
} from '../../src/versionCheck';

it.each([
  ['0.12.0', true],
  ['0.12.9', true],
  ['0.11.9', false],
  ['0.13.0', false],
  ['1.0.0', false],
  [undefined, false],
  ['garbage', false],
] as const)('checks core version %s', (version, supported) => {
  expect(isSupportedCoreVersion(version)).toBe(supported);
});

it.each(['0.11.9', '0.13.0', undefined])(
  'explains the final release range for %s',
  (version) => {
    expect(formatUnsupportedCoreVersionMessage(version)).toBe(
      `This extension is no longer maintained and only supports @rstest/core ^0.12.0 (found ${version ?? 'unknown'}). Install the Rstack extension (rstack.rstack) instead.`,
    );
  },
);
