import { basename } from 'node:path';
import { expect, it, rs } from '@rstest/core';

rs.mock('node:path', () => ({ basename: () => 'mocked path' }));

it('runs in jsdom', () => {
  expect(document.body).toBeInstanceOf(HTMLBodyElement);
});

it('keeps module mocks hoisted in test files', () => {
  expect(basename('/example/file.txt')).toBe('mocked path');
});
