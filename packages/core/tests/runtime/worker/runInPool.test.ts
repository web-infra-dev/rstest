import { expect, test } from '@rstest/core';
import vm from 'node:vm';
import {
  installVmNodeGlobals,
  isBlockedProcessKillTarget,
} from '../../../src/runtime/worker/runInPool';

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
