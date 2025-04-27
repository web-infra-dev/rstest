import { formatName } from '../../src/runtime/util';

it('test formatName', () => {
  expect(formatName('test index %#', [1, 2, 3], 1)).toBe('test index 1');

  expect(formatName('test %i + %i -> %i', [1, 2, 3], 0)).toBe(
    'test 1 + 2 -> 3',
  );

  expect(formatName('test $a', { a: 1 }, 0)).toBe('test 1');

  expect(formatName('test $a.b', { a: { b: 1 } }, 0)).toBe('test 1');

  expect(formatName('test $c', { a: { b: 1 } }, 0)).toBe('test undefined');
});
