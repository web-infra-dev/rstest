import * as api from '../../../src/runtime/api/public';
import { globalApis } from '../../../src/utils/constants';
import {
  installGlobalApis,
  installGlobalProperty,
} from '../../../src/runtime/worker/globalProperty';

describe('installGlobalProperty', () => {
  it('removes a property that did not exist before installation', () => {
    const target = {};
    const value = Symbol('installed value');
    const restore = installGlobalProperty(target, 'example', value);
    expect(Reflect.get(target, 'example')).toBe(value);

    restore();
    expect(Object.hasOwn(target, 'example')).toBe(false);
  });

  it('restores an existing property descriptor', () => {
    const target = {};
    const previousValue = Symbol('previous value');
    Object.defineProperty(target, 'example', {
      value: previousValue,
      writable: true,
      enumerable: false,
      configurable: false,
    });
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      target,
      'example',
    );

    const restore = installGlobalProperty(
      target,
      'example',
      Symbol('installed value'),
    );

    restore();
    expect(Object.getOwnPropertyDescriptor(target, 'example')).toEqual(
      previousDescriptor,
    );
  });
});

it('installs and restores all global APIs', () => {
  const target = {};
  const restore = installGlobalApis(api, target);

  for (const key of globalApis) {
    expect(Reflect.get(target, key)).toBe(api[key]);
  }

  restore();

  for (const key of globalApis) {
    expect(Object.hasOwn(target, key)).toBe(false);
  }
});
