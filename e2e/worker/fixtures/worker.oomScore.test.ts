import { readFileSync } from 'node:fs';
import { expect, it } from '@rstest/core';

it('runs with the highest OOM score', () => {
  expect(readFileSync('/proc/self/oom_score_adj', 'utf8').trim()).toBe('1000');
});
