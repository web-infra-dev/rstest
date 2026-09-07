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
  it('passes caller-supplied full-shape argv through unchanged', () => {
    const argv = [
      '/usr/local/bin/node',
      '/project/node_modules/.bin/rstest',
      'run',
      'sum.test.ts',
      '--watch',
    ];
    runCLI({ argv });

    expect(prepareCliSpy).toHaveBeenCalledOnce();
    expect(setupCommandsSpy).toHaveBeenCalledWith(argv);
  });

  it('passes process.argv through unchanged by default', () => {
    process.argv = [
      '/usr/local/bin/node',
      '/project/node_modules/.bin/rstest',
      'run',
      'sum.test.ts',
    ];

    runCLI();

    expect(setupCommandsSpy).toHaveBeenCalledWith(process.argv);
  });
});
