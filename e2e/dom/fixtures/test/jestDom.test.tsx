import { expect, test } from '@rstest/core';
import { screen } from '@testing-library/dom';

test('uses jest-dom', () => {
  document.body.innerHTML = `
    <span data-testid="not-empty"><span data-testid="empty"></span></span>
    <div data-testid="visible">Visible Example</div>
  `;

  expect(screen.queryByTestId('not-empty')).not.toBeEmptyDOMElement();
  expect(screen.getByText('Visible Example')).toBeVisible();
  expect(() => expect(document.createElement('div')).toBeNull()).toThrow(
    'expected <div></div> to be null',
  );
});

test('matches DOM nodes across VM realms', () => {
  const parent = document.createElement('div');
  const child = document.createElement('span');
  parent.append(child);
  parent.classList.add('active');

  expect(parent).toContain(child);
  expect(parent).not.toContain(document.createElement('span'));
  expect(parent.classList).toContain('active');
});
