import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { setupCommands } from '../../src/cli/commands';
import { runCLI } from '../../src/cli';
import { prepareCli } from '../../src/cli/prepare';

rs.mock('../../src/cli/commands', () => ({
  setupCommands: rs.fn(),
}));
rs.mock('../../src/cli/prepare', () => ({
  prepareCli: rs.fn(),
}));

const originalArgv = process.argv;
const setupCommandsSpy = rs.mocked(setupCommands);
const prepareCliSpy = rs.mocked(prepareCli);

afterEach(() => {
  process.argv = originalArgv;
  rs.clearAllMocks();
});

describe('runCLI', () => {
  it('accepts arguments written after the rstest command', () => {
    runCLI({ argv: ['run', 'sum.test.ts', '--watch'] });

    expect(prepareCliSpy).toHaveBeenCalledOnce();
    expect(setupCommandsSpy).toHaveBeenCalledWith([
      'node',
      'rstest',
      'run',
      'sum.test.ts',
      '--watch',
    ]);
  });

  it('defaults to the arguments after the executable and script', () => {
    process.argv = [
      '/usr/local/bin/node',
      '/project/node_modules/.bin/rstest',
      'run',
      'sum.test.ts',
    ];

    runCLI();

    expect(setupCommandsSpy).toHaveBeenCalledWith([
      'node',
      'rstest',
      'run',
      'sum.test.ts',
    ]);
  });
});
