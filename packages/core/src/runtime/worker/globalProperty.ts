import type { Rstest } from '../../types';
import { globalApis } from '../../utils/constants';

export const installGlobalProperty = (
  target: object,
  key: PropertyKey,
  value: unknown,
): (() => void) => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!Reflect.set(target, key, value)) {
    throw new TypeError(`Cannot install global property: ${String(key)}`);
  }

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(target, key, previousDescriptor);
    } else {
      Reflect.deleteProperty(target, key);
    }
  };
};

export const installGlobalApis = (
  api: Rstest,
  target: object = globalThis,
): (() => void) => {
  const restores = globalApis.map((key) =>
    installGlobalProperty(target, key, api[key]),
  );

  return () => {
    for (const restore of restores) {
      restore();
    }
  };
};
