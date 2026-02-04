import { afterAll, expect, it, rs } from '@rstest/core';
import { useEffect } from 'react';

rs.mock('react', () => {
  const originalModule = rs.requireActual('react');

  expect(originalModule.useEffect).toBeDefined();
  return {
    ...originalModule,
    useEffect: rs.fn(),
  };
});

afterAll(() => {
  rs.doUnmock('react');
});

it('mocked react', () => {
  expect(rs.isMockFunction(useEffect)).toBe(true);

  useEffect(() => {
    console.log('useEffect');
  });
  expect(useEffect).toHaveBeenCalled();

  const originalReact = rs.requireActual('react');
  expect(rs.isMockFunction(originalReact.useEffect)).toBe(false);
});
