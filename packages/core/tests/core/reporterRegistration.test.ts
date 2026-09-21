import { expect, rs, test } from '@rstest/core';
import { Rstest } from '../../src/core/rstest';

test.for(['tuple', 'string'] as const)(
  'cleans up initialized reporters when %s module loading fails',
  async (form) => {
    const onExit = rs.fn();
    const context = new Rstest(
      { cwd: process.cwd(), command: 'run', projects: [] },
      {
        reporters: [
          { onExit },
          form === 'string'
            ? './missing-reporter.mjs'
            : ['./missing-reporter.mjs', {}],
        ],
      },
    );

    await expect(context.initializeReporters()).rejects.toThrow(
      'Failed to resolve reporter module "./missing-reporter.mjs".',
    );
    expect(onExit).toHaveBeenCalledTimes(1);
  },
);
