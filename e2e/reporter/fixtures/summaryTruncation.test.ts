import { expect, it } from '@rstest/core';

it('reports a long diff', () => {
  expect([
    'received first line',
    ...Array.from(
      { length: 40 },
      (_, index) => `received context line ${index}`,
    ),
    'received last line',
  ]).toEqual([
    'expected first line',
    ...Array.from(
      { length: 40 },
      (_, index) => `expected context line ${index}`,
    ),
    'expected last line',
  ]);
});

it('reports truncated Markdown logs', { retry: 2 }, () => {
  throw new Error(
    [
      'CLI log:',
      '````text',
      '</details>',
      '````',
      '```text',
      'x'.repeat(10_000),
    ].join('\n'),
  );
});

it('reports the following failure', () => {
  throw new Error('following failure');
});
