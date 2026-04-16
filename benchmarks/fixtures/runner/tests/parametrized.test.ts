import { describe, expect, it } from '@rstest/core';

function formatTaskLabel(
  project: string,
  mode: 'run' | 'watch',
  shardIndex: number,
): string {
  return `${project}:${mode}:shard-${shardIndex}`;
}

describe('runtime parametrized execution', () => {
  it.each([
    ['core', 'run', 1, 'core:run:shard-1'],
    ['runner', 'watch', 2, 'runner:watch:shard-2'],
    ['codspeed', 'run', 3, 'codspeed:run:shard-3'],
    ['rstest', 'watch', 4, 'rstest:watch:shard-4'],
  ] as const)('formats a task label for %s', (project, mode, shardIndex, expected) => {
    expect(formatTaskLabel(project, mode, shardIndex)).toBe(expected);
  });
});
