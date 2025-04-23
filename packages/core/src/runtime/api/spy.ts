import { getInternalState, internalSpyOn } from 'tinyspy';
import type { FunctionLike, Mock, MockFn } from '../../types';

const wrapSpy = <T extends FunctionLike>(
  obj: Record<string, any>,
  methodName: string,
  mockFn?: T,
): Mock<T> => {
  const spyImpl = internalSpyOn(obj, methodName, mockFn);

  const spyFn = spyImpl as unknown as Mock<T>;

  const mockImplementationOnce: T[] = [];
  let implementation = mockFn;

  const mockState = {
    mockName: mockFn?.name,
  };

  const spyState = getInternalState(spyImpl);

  spyFn.getMockName = () => mockState.mockName || methodName;

  spyFn.mockName = (name: string) => {
    mockState.mockName = name;

    return spyFn;
  };

  spyFn.getMockImplementation = () => {
    return mockImplementationOnce.length
      ? mockImplementationOnce[mockImplementationOnce.length - 1]
      : implementation;
  };

  spyFn.mockImplementation = (fn) => {
    implementation = fn;
    return spyFn;
  };

  spyFn.mockImplementationOnce = (fn) => {
    mockImplementationOnce.push(fn);
    return spyFn;
  };

  function willCall(this: unknown, ...args: any) {
    let impl = implementation;
    if (mockImplementationOnce.length) {
      impl = mockImplementationOnce.shift();
    }
    return impl?.apply(this, args);
  }

  spyState.willCall(willCall);

  Object.defineProperty(spyFn, 'mock', {
    get: () => ({
      get calls() {
        return spyState.calls;
      },
    }),
  });

  return spyFn;
};

export const fn: MockFn = <T extends FunctionLike>(mockFn?: T) => {
  const defaultName = 'rstest.fn()';

  return wrapSpy(
    {
      [defaultName]: mockFn,
    },
    defaultName,
    mockFn,
  );
};
