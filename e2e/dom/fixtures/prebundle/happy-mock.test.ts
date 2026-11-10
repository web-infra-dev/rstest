import { expect, it, rs } from '@rstest/core';
import { Window } from 'happy-dom';

rs.mock('happy-dom', () => ({
  Window: class {
    name = 'mocked';
  },
}));

it('can mock happy-dom without mocking the environment', () => {
  expect(new Window().name).toBe('mocked');
  expect(document.createElement('p').tagName).toBe('P');
});
