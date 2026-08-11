import { writeFileSync } from 'node:fs';
import { afterAll, expect, test } from '@rstest/core';
import { projectAFinishedMarker } from './marker';

test('installs project A global APIs', () => {
  expect(Reflect.has(globalThis, 'test')).toBe(true);
  expect(Reflect.has(globalThis, 'expect')).toBe(true);
  console.log('PROJECT_A_INTERCEPTED_LOG');
});

afterAll(() => {
  writeFileSync(projectAFinishedMarker, '');
});
