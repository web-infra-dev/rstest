import { expect, test } from '@rstest/core';

test('formats ordinary objects in assertion messages', () => {
  expect(() => expect({ value: 1 }).equal(null)).toThrow(
    'expected { value: 1 } to equal null',
  );
  expect(() => expect({ nested: { value: 1 } }).equal(null)).toThrow(
    'expected { nested: { value: 1 } } to equal null',
  );
  expect(() =>
    expect(Object.setPrototypeOf({ value: 1 }, null)).equal(null),
  ).toThrow('expected { value: 1 } to equal null');
  expect(() => expect({ constructor: 'custom', value: 1 }).equal(null)).toThrow(
    "expected { constructor: 'custom', value: 1 } to equal null",
  );
});

test('preserves class names in assertion messages', () => {
  class Item {
    value = 1;
  }
  class NamedObject {
    value = 1;
  }
  // Preserve the class name across bundler symbol renaming.
  Object.defineProperty(NamedObject, 'name', { value: 'Object' });
  expect(() => expect(new Item()).equal(null)).toThrow(
    'expected Item{ value: 1 } to equal null',
  );
  expect(() => expect(new NamedObject()).equal(null)).toThrow(
    'expected Object{ value: 1 } to equal null',
  );
});

test.for(['chai/inspect', 'nodejs.util.inspect.custom'])(
  'preserves custom inspect with %s',
  (symbol) => {
    const value = {
      [Symbol.for(symbol)]() {
        return 'custom value';
      },
    };
    expect(() => expect(value).equal(null)).toThrow(
      'expected custom value to equal null',
    );
  },
);

test('uses the configured poll timeout', async () => {
  await expect(expect.poll(() => false).toBe(true)).rejects.toThrow(
    'Matcher did not succeed in 200ms',
  );
});

test('uses the configured poll interval', async () => {
  let attempts = 0;

  await expect.poll(() => ++attempts).toBe(6);
});

test('prefers call options over the configured defaults', async () => {
  await expect(
    expect.poll(() => false, { timeout: 50 }).toBe(true),
  ).rejects.toThrow('Matcher did not succeed in 50ms');
});
