import { expect, test } from '@rstest/core';

test('jsx runtime works without React in scope', () => {
  const element = <span>hello</span>;
  expect(element.props.children).toBe('hello');
});
