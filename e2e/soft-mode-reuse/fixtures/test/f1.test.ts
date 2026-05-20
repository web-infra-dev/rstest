import { describe, expect, it } from '@rstest/core';
import { recordPid } from './record-pid';

recordPid('f1');

describe('soft mode reuse — file 1', () => {
  it('runs and records its pid', () => {
    expect(true).toBe(true);
  });
});
