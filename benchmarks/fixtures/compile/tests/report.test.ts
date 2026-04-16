import { describe, expect, it } from '@rstest/core';
import { renderScenarioReport } from '../src';

describe('compile graph report', () => {
  it('emits a deterministic multi-line report', () => {
    expect(renderScenarioReport()).toBe(
      [
        'entry:7:9:compile graph|mock tracker|snapshot formatter',
        'branch:2:2:list collector|runtime hooks',
        'leaf:0:0:module cache',
      ].join('\n'),
    );
  });
});
