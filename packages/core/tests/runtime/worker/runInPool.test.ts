import { expect, test } from '@rstest/core';
import vm from 'node:vm';
import { util } from 'chai';
import { setupVM } from '../../../src/runtime/worker/env/jsdom';
import {
  installVmNodeGlobals,
  installWorkerHTMLElement,
} from '../../../src/runtime/worker/vm/nodeGlobals';
import { isBlockedProcessKillTarget } from '../../../src/runtime/worker/runInPool';

test('bridges host getters without invoking host setters or sharing assignments', () => {
  const key = '__RSTEST_VM_ACCESSOR_TEST__';
  let hostValue: unknown = 'host';
  Object.defineProperty(globalThis, key, {
    configurable: true,
    get() {
      expect(this).toBe(globalThis);
      return hostValue;
    },
    set(value: unknown) {
      hostValue = value;
    },
  });
  try {
    const context = vm.createContext({});
    installVmNodeGlobals(vm.runInContext('globalThis', context), context);
    expect(vm.runInContext(key, context)).toBe('host');
    vm.runInContext(`${key} = undefined`, context);
    expect(vm.runInContext(key, context)).toBeUndefined();
    expect(hostValue).toBe('host');
    const next = vm.createContext({});
    installVmNodeGlobals(vm.runInContext('globalThis', next), next);
    expect(vm.runInContext(key, next)).toBe('host');
  } finally {
    Reflect.deleteProperty(globalThis, key);
  }
});

test('blocks process-group and current-process kill targets', () => {
  expect(isBlockedProcessKillTarget(0, 123)).toBe(true);
  expect(isBlockedProcessKillTarget(-1, 123)).toBe(true);
  expect(isBlockedProcessKillTarget(123, 123)).toBe(true);
  expect(isBlockedProcessKillTarget(-123, 123)).toBe(true);
  expect(isBlockedProcessKillTarget(456, 123)).toBe(false);
});

test.for([false, true])(
  'formats VM DOM nodes and restores worker globals (previous constructor: %s)',
  async (hasPrevious) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
    const previous = {
      configurable: true,
      get: () => class PreviousElement {},
    };
    if (hasPrevious) {
      Object.defineProperty(globalThis, 'HTMLElement', previous);
    } else {
      Reflect.deleteProperty(globalThis, 'HTMLElement');
    }

    try {
      for (let index = 0; index < 2; index++) {
        const environment = await setupVM({}, { scope: 'file' });
        const restore = installWorkerHTMLElement(
          vm.runInContext('globalThis', environment.context),
        );
        try {
          const element = vm.runInContext(
            'document.createElement("div")',
            environment.context,
          );
          Object.defineProperty(element, 'reactInternals', {
            enumerable: true,
            get() {
              throw new Error('DOM internals must not be inspected');
            },
          });
          expect(util.inspect(element)).toBe('<div></div>');
        } finally {
          restore();
          await environment.teardown();
        }
        expect(
          Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement'),
        ).toEqual(
          hasPrevious
            ? { ...previous, enumerable: original?.enumerable ?? false }
            : undefined,
        );
      }
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'HTMLElement', original);
      } else {
        Reflect.deleteProperty(globalThis, 'HTMLElement');
      }
    }
  },
);
