import { expect, it, rs } from '@rstest/core';
import redux from 'redux';
import { leaf } from '../src/mockOrderLeaf';
import { state } from '../src/mockOrderState';
import '../src/mockOrderTarget';

rs.mock('../src/mockOrderTarget');
rs.mock('../src/mockOrderLeaf', () => ({ leaf: rs.fn() }));
rs.mock('redux');

it('defers auto-mock evaluation until all hoisted mocks are registered', () => {
  expect(state.value).toBe(leaf);
});

it('keeps manual __mocks__ and factory mocks working', () => {
  // @ts-expect-error: the manual mock adds this property.
  expect(redux.mocked).toBe('redux_yes');
  expect(rs.isMockFunction(leaf)).toBe(true);
});
