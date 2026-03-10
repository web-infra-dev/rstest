import { describe, expect, it } from '@rstest/core';
import { getBrowserWatchCliShortcutsHintMessage } from '../src/watchCliShortcuts';

const stripAnsi = (value: string): string => {
  let result = '';
  let index = 0;

  while (index < value.length) {
    if (value[index] === String.fromCharCode(27) && value[index + 1] === '[') {
      index += 2;
      while (index < value.length && value[index] !== 'm') {
        index += 1;
      }
      index += 1;
      continue;
    }

    result += value[index];
    index += 1;
  }

  return result;
};

describe('browser watch cli shortcuts', () => {
  it('should render the watch hint message', () => {
    const message = stripAnsi(getBrowserWatchCliShortcutsHintMessage());

    expect(message).toContain('press q to quit');
    expect(message).not.toContain('press h to show help');
  });
});
