import { expect, test } from '@rstest/core';
import { screen } from '@testing-library/dom';
import { capturedBody, capturedDocument, getSharedEvalId } from './shared';

test('b: statically imported module is shared across files', () => {
  expect(getSharedEvalId()).toBe(1);
});

// Peer of the same test in a.test.ts (see the rationale there).
test('b: module-eval-time DOM captures stay live', () => {
  expect(capturedBody).toBe(document.body);
  expect(capturedDocument).toBe(document);
  document.body.innerHTML = '<p>b-marker</p>';
  expect(screen.getByText('b-marker')).toBeTruthy();
});

test('b: dynamically imported module is shared across files', async () => {
  const { getDynEvalId } = await import('./dynShared');
  expect(getDynEvalId()).toBe(1);
});

test('b: setup re-ran for this file', () => {
  expect((globalThis as Record<string, any>).__rstestSetupFor).toContain(
    'b.test',
  );
});
