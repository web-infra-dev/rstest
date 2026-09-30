import { expect, it, rs } from '@rstest/core';
import { increment } from '../src/increment';

rs.mock('../src/increment', { spy: true });

it('spy mode preserves the original implementation and tracks calls', () => {
  expect(increment(1)).toBe(2);
  expect(rs.isMockFunction(increment)).toBe(true);
  expect(increment).toHaveBeenCalledWith(1);
  expect(increment).toHaveReturnedWith(2);
});

it('spy mode allows overriding and resetting the implementation', () => {
  rs.mocked(increment).mockImplementation((num: number) => num + 100);
  expect(increment(1)).toBe(101);

  rs.mocked(increment).mockReset();
  expect(increment(1)).toBe(2);
});

it('restoreAllMocks preserves mock implementations and restores object spies', () => {
  const mock = rs.fn().mockReturnValue('mocked');
  const object = { method: () => 'original' };
  const spy = rs.spyOn(object, 'method').mockReturnValue('spied');

  expect(mock()).toBe('mocked');
  expect(object.method()).toBe('spied');

  rs.restoreAllMocks();

  expect(mock()).toBe('mocked');
  expect(mock.mock.calls).toEqual([[], []]);
  expect(object.method()).toBe('original');
  expect(spy.mock.calls).toEqual([[]]);
});
