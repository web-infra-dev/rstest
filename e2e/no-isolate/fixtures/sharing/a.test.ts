import { expect, test } from '@rstest/core';
import { screen } from '@testing-library/dom';
import { capturedBody, capturedDocument, getSharedEvalId } from './shared';

test('a: statically imported module is shared across files', () => {
  expect(getSharedEvalId()).toBe(1);
});

// Peer of the same test in b.test.ts — no execution-order assumption; whichever
// file runs second reads captures taken while the other file was loading, and
// so exercises the environment persisted from it.
test('a: module-eval-time DOM captures stay live', () => {
  expect(capturedBody).toBe(document.body);
  expect(capturedDocument).toBe(document);
  document.body.innerHTML = '<p>a-marker</p>';
  expect(screen.getByText('a-marker')).toBeTruthy();
});

test('a: dynamically imported module is shared across files', async () => {
  const { getDynEvalId } = await import('./dynShared');
  expect(getDynEvalId()).toBe(1);
});

test('a: setup re-ran for this file', () => {
  expect((globalThis as Record<string, any>).__rstestSetupFor).toContain(
    'a.test',
  );
});
