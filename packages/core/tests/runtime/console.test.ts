import { inspect, stripVTControlCharacters } from 'node:util';
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

describe('console.group', () => {
  it('indents grouped output as Node does', () => {
    const onConsoleLog = rs.fn();
    const console = createCustomConsole({
      silent: false,
      onConsoleLog,
      getCurrentTask: () => undefined,
      testPath: '/test.ts',
      project: '',
      printConsoleTrace: false,
    });

    console.group('Group A');
    console.log('inside');
    console.log('line 1\nline 2');
    console.groupCollapsed('Group B');
    console.warn('nested 1\nnested 2');
    console.groupEnd();
    console.groupEnd();
    console.log('outside');

    expect(
      onConsoleLog.mock.calls.map(([log]) =>
        stripVTControlCharacters(log.content),
      ),
    ).toEqual([
      'Group A',
      '  inside',
      '  line 1\n  line 2',
      '  Group B',
      '    nested 1\n    nested 2',
      'outside',
    ]);
  });
});

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

describe('console.assert', () => {
  it('prints a failed assertion as Node does', () => {
    const onConsoleLog = rs.fn();
    const console = createCustomConsole({
      silent: false,
      onConsoleLog,
      getCurrentTask: () => undefined,
      testPath: '/test.ts',
      project: '',
      printConsoleTrace: false,
    });

    console.assert(false, 'expected %d items, got %d', 3, 2);
    console.assert(false, 'missing', { id: 1 });
    console.assert(false, { id: 1 });
    console.assert(false, new Error('boom'));
    console.assert(false);
    console.assert(true, 'not printed');

    expect(
      onConsoleLog.mock.calls.map(([log]) => [log.content, log.type]),
    ).toEqual([
      ['Assertion failed: expected 3 items, got 2', 'stderr'],
      ['Assertion failed: missing { id: 1 }', 'stderr'],
      ['Assertion failed { id: 1 }', 'stderr'],
      [
        expect.stringMatching(/^Assertion failed Error: boom\n {4}at /),
        'stderr',
      ],
      ['Assertion failed', 'stderr'],
    ]);
  });
});
