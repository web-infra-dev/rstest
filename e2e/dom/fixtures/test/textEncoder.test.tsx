import { expect, test } from '@rstest/core';

// https://github.com/capricorn86/happy-dom/pull/1612
test('should work with Uint8Array and TextEncoder in happy-dom', () => {
  expect([1]).toEqual([1]);
  expect(new TextEncoder().encode('a')).toEqual(new TextEncoder().encode('a'));
  expect(Uint8Array.from([97])).toEqual(new TextEncoder().encode('a'));
});

test('keeps TextEncoder output and encodeInto results in the current realm', () => {
  const encoder = new TextEncoder();
  const encoded = encoder.encode('A😀');
  expect(encoded).toBeInstanceOf(Uint8Array);
  expect(encoded.buffer).toBeInstanceOf(ArrayBuffer);
  expect(encoded).toEqual(Uint8Array.from([65, 240, 159, 152, 128]));

  const destination = new Uint8Array(5);
  const result = encoder.encodeInto('A😀', destination);
  expect(result).toBeInstanceOf(Object);
  expect(result).toEqual({ read: 3, written: 5 });
  expect(destination).toEqual(encoded);

  const partial = new Uint8Array(3);
  expect(encoder.encodeInto('A😀', partial)).toEqual({ read: 1, written: 1 });
  expect(partial).toEqual(Uint8Array.from([65, 0, 0]));
});
