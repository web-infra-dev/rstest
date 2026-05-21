import { describe, expect, it } from '@rstest/core';
import { recordPid } from './record-pid';

recordPid('f2');

describe('memory limit recycle — file 2', () => {
  it('runs and records its pid', () => {
    expect(true).toBe(true);
  });
});
