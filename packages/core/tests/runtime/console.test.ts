import { inspect } from 'node:util';
import { describe, expect, it, rs } from '@rstest/core';
import { createCustomConsole } from '../../src/runtime/worker/console';

const outputMethods = [
  'log',
  'info',
  'debug',
  'warn',
  'error',
  'dirxml',
  'group',
  'groupCollapsed',
  'trace',
  'table',
] as const;

describe('silent console', () => {
  it.for(outputMethods)('does not inspect arguments for %s', (method) => {
    const onConsoleLog = rs.fn();
    const getCurrentTask = rs.fn();
    const customInspect = rs.fn(() => 'formatted');
    const console = createCustomConsole({
      silent: true,
      onConsoleLog,
      getCurrentTask,
      testPath: '/test.ts',
      project: '',
      printConsoleTrace: true,
    });

    console[method]({ [inspect.custom]: customInspect });

    expect(customInspect).not.toHaveBeenCalled();
    expect(getCurrentTask).not.toHaveBeenCalled();
    expect(onConsoleLog).not.toHaveBeenCalled();
  });

  it('does not inspect getters in console.dir or coerce assertion messages', () => {
    const getter = rs.fn(() => 'value');
    const toString = rs.fn(() => 'assertion');
    const console = createCustomConsole({
      silent: true,
      onConsoleLog: rs.fn(),
      getCurrentTask: rs.fn(),
      testPath: '/test.ts',
      project: '',
      printConsoleTrace: false,
    });
    console.dir(
      Object.defineProperty({}, 'value', { get: getter, enumerable: true }),
      { getters: true },
    );
    console.assert(false, { toString });

    expect(getter).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
  });

  it('formats visible logs once and retains task attribution', () => {
    const onConsoleLog = rs.fn();
    const customInspect = rs.fn(() => 'formatted');
    const console = createCustomConsole({
      silent: false,
      onConsoleLog,
      getCurrentTask: () => ({
        taskId: 'case:1',
        taskType: 'case',
        testPath: '/test.ts',
      }),
      testPath: '/test.ts',
      project: 'node',
      printConsoleTrace: false,
    });
    console.log({ [inspect.custom]: customInspect });

    expect(customInspect).toHaveBeenCalledTimes(1);
    expect(onConsoleLog).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'formatted',
        taskId: 'case:1',
        project: 'node',
        trace: undefined,
      }),
    );
  });
});
